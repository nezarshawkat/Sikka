import bundledSnapshotRaw from '@/data/bundledSnapshot.json';
import { apiFetch } from '@/lib/api';

type SnapshotLine = Record<string, unknown> & { id: string; transportTypeId: string; path?: [number, number][]; routeStatus?: string };
type SnapshotType = Record<string, unknown> & { id: string };
export type OfflineSnapshot = {
  schemaVersion: number;
  generatedAt: string;
  revision: string;
  types: SnapshotType[];
  lines: SnapshotLine[];
  heatmaps?: unknown[];
  authoritative?: boolean;
};

const bundledSnapshot = bundledSnapshotRaw as unknown as OfflineSnapshot;
const DB_NAME = 'sikka-offline';
const STORE_NAME = 'snapshots';
const SNAPSHOT_KEY = 'latest';
const ROUTE_SYNC_MIN_INTERVAL_MS = 10 * 60 * 1000;
export const ROUTES_UPDATED_EVENT = 'sikka:routes-updated';
let memorySnapshot: OfflineSnapshot | null = null;
let refreshInFlight: Promise<OfflineSnapshot | null> | null = null;
let lastCheckedAt = 0;

export function isValidSnapshot(value: unknown): value is OfflineSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as OfflineSnapshot;
  return snapshot.schemaVersion === 3 && typeof snapshot.revision === 'string'
    && Array.isArray(snapshot.types) && snapshot.types.every(type => typeof type?.id === 'string')
    && Array.isArray(snapshot.lines) && snapshot.lines.every(line =>
      typeof line?.id === 'string' && typeof line.transportTypeId === 'string'
      && (line.path == null || (Array.isArray(line.path) && line.path.every(point =>
        Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])
        && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90))));
}

function revisionStamp(revision: string | undefined | null): number {
  if (!revision) return 0;
  const parts = revision.split('-');
  const stamp = Number(parts[1]);
  return Number.isFinite(stamp) ? stamp : 0;
}

export function pickLatestSnapshot(current: OfflineSnapshot | null | undefined, candidate: OfflineSnapshot | null | undefined): OfflineSnapshot | null {
  if (!candidate) return current ?? null;
  if (!current) return candidate;
  // A downloaded full snapshot is authoritative even if removing the newest
  // line lowered the server's maximum updatedAt timestamp.
  if (candidate.authoritative) return candidate;
  if (current.authoritative) return current;
  const currentStamp = revisionStamp(current.revision) || Date.parse(current.generatedAt) || 0;
  const candidateStamp = revisionStamp(candidate.revision) || Date.parse(candidate.generatedAt) || 0;
  return candidateStamp >= currentStamp ? candidate : current;
}

export function mergeSnapshotUpdates(current: OfflineSnapshot, update: OfflineSnapshot): OfflineSnapshot {
  const linesById = new Map(current.lines.map((line) => [line.id, line]));
  for (const line of update.lines) {
    linesById.set(line.id, {
      ...linesById.get(line.id),
      ...line,
    });
  }

  return {
    ...current,
    generatedAt: update.generatedAt || new Date().toISOString(),
    revision: update.revision || current.revision,
    types: update.types.length ? update.types : current.types,
    lines: [...linesById.values()],
    heatmaps: Array.isArray(update.heatmaps) ? update.heatmaps : current.heatmaps,
    authoritative: true,
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Route storage is blocked'));
  });
}

async function writeSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  memorySnapshot = snapshot;
  if (typeof window === 'undefined' || !('indexedDB' in window)) return;
  try {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ snapshot, savedAt: Date.now() }, SNAPSHOT_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
  } catch (error) {
    // Routes remain usable for this session when storage is full or denied.
    console.warn('[routes] Could not persist snapshot', error);
  }
}

export async function readSnapshot(): Promise<OfflineSnapshot> {
  if (memorySnapshot) return memorySnapshot;
  if (typeof window === 'undefined' || !('indexedDB' in window)) return bundledSnapshot;
  try {
    const db = await openDb();
    const stored = await new Promise<{ snapshot?: OfflineSnapshot } | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
    if (memorySnapshot) return memorySnapshot;
    if (isValidSnapshot(stored?.snapshot)) {
      if (!stored.snapshot.lines.length && bundledSnapshot.lines.length) {
        memorySnapshot = bundledSnapshot;
        return memorySnapshot;
      }
      memorySnapshot = stored.snapshot;
      return memorySnapshot;
    }
  } catch {
    // Use the bundled snapshot when IndexedDB is unavailable.
  }
  if (memorySnapshot) return memorySnapshot;
  await writeSnapshot(bundledSnapshot);
  return bundledSnapshot;
}

function toUiLine(line: SnapshotLine): Record<string, unknown> {
  const path = Array.isArray(line.path) ? line.path : [];
  return {
    ...line,
    routePath: path.length >= 2 ? { type: 'LineString', coordinates: path } : null,
    isActive: line.isActive !== false && (line.routeStatus === 'active' || line.routeStatus === 'needs_review' || !line.routeStatus),
    routeDirection: line.routeDirection ?? 'forward',
    governorate: line.governorate ?? 'Cairo',
    viaStops: Array.isArray(line.viaStops) ? line.viaStops : [],
    stops: line.stops ?? null,
  };
}

function toSnapshotLine(route: Record<string, unknown>, existing?: SnapshotLine): SnapshotLine {
  const geometry = route.routePath as { coordinates?: [number, number][] } | null | undefined;
  const path = geometry?.coordinates ?? (Array.isArray(route.path) ? route.path as [number, number][] : existing?.path ?? []);
  const merged = {
    ...existing,
    ...route,
    path,
    pathPointCount: path.length,
    updatedAt: (route.updatedAt as string | undefined) ?? new Date().toISOString(),
  } as SnapshotLine & { routePath?: unknown };
  delete merged.routePath;
  return merged;
}

function changedSnapshot(snapshot: OfflineSnapshot, lines: SnapshotLine[]): OfflineSnapshot {
  return {
    ...snapshot,
    generatedAt: new Date().toISOString(),
    revision: `${snapshot.revision.split(':local:')[0]}:local:${Date.now()}`,
    lines,
  };
}

function announceUpdate(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ROUTES_UPDATED_EVENT));
}

async function refreshSnapshot(force: boolean): Promise<OfflineSnapshot | null> {
  const current = await readSnapshot();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const manifest = await apiFetch<{ revision: string; deltaUrl?: string }>('/offline/manifest', { cache: 'no-store', signal: controller.signal });
    if (!force && current.authoritative && current.revision === manifest.revision) {
      lastCheckedAt = Date.now();
      return current;
    }

    const deltaPath = manifest.deltaUrl || '/api/offline/delta';
    const deltaUrl = deltaPath.replace(/^\/api/, '');
    const refreshed = await apiFetch<OfflineSnapshot>(
      `${deltaUrl}?sinceRevision=${encodeURIComponent(current.revision)}`,
      { cache: 'no-store', signal: controller.signal },
    );
    if (!isValidSnapshot(refreshed)) return current;

    const next = mergeSnapshotUpdates(current, refreshed);
    if (!next.lines.length && bundledSnapshot.lines.length) {
      // Do not let an unseeded database erase the routes shipped with the app.
      const fallback = { ...bundledSnapshot, authoritative: true };
      await writeSnapshot(fallback);
      lastCheckedAt = Date.now();
      return fallback;
    }

    await writeSnapshot(next);
    lastCheckedAt = Date.now();
    if (current.revision !== next.revision || !current.authoritative || refreshed.lines.length > 0) announceUpdate();
    return next;
  } catch {
    if (force) {
      try {
        const refreshed = await apiFetch<OfflineSnapshot>('/offline/snapshot', { cache: 'no-store', signal: controller.signal });
        if (!isValidSnapshot(refreshed)) return current;
        const next = mergeSnapshotUpdates(current, refreshed);
        await writeSnapshot(next);
        lastCheckedAt = Date.now();
        if (current.revision !== next.revision || !current.authoritative || refreshed.lines.length > 0) announceUpdate();
        return next;
      } catch {
        return current;
      }
    }
    return current;
  } finally { clearTimeout(timer); }
}

export function refreshLocalRouteSnapshot(force = false): Promise<OfflineSnapshot | null> {
  if (refreshInFlight) {
    // An admin save must not join a request that started before the mutation.
    return force ? refreshInFlight.then(() => refreshLocalRouteSnapshot(true)) : refreshInFlight;
  }
  if (!force && Date.now() - lastCheckedAt < ROUTE_SYNC_MIN_INTERVAL_MS) return readSnapshot();
  refreshInFlight = refreshSnapshot(force).finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

export async function getLocalRouteCatalog<TLine, TType>(): Promise<{ routes: TLine[]; transportTypes: TType[] }> {
  const snapshot = await readSnapshot();
  return { routes: snapshot.lines.map(toUiLine) as TLine[], transportTypes: snapshot.types as TType[] };
}

export async function getLocalTransitLine<TLine, TType>(id: string): Promise<{ route: TLine | null; transportType: TType | null }> {
  const snapshot = await readSnapshot();
  const line = snapshot.lines.find((item) => item.id === id);
  const type = line ? snapshot.types.find((item) => item.id === line.transportTypeId) : undefined;
  return { route: line ? toUiLine(line) as TLine : null, transportType: (type as TType | undefined) ?? null };
}

export async function saveLocalTransitLine(route: Record<string, unknown>): Promise<void> {
  const id = String(route.id ?? '');
  if (!id) throw new Error('Cannot cache a route without an id');
  const snapshot = await readSnapshot();
  const existing = snapshot.lines.find((item) => item.id === id);
  const next = toSnapshotLine(route, existing);
  const lines = existing ? snapshot.lines.map((item) => item.id === id ? next : item) : [...snapshot.lines, next];
  await writeSnapshot(changedSnapshot(snapshot, lines));
  announceUpdate();
  await refreshLocalRouteSnapshot(true);
}

export async function deleteLocalTransitLine(id: string): Promise<void> {
  const snapshot = await readSnapshot();
  await writeSnapshot(changedSnapshot(snapshot, snapshot.lines.filter((line) => line.id !== id)));
  announceUpdate();
}

export async function deleteLocalTransitLines(ids: string[]): Promise<void> {
  const removed = new Set(ids);
  if (!removed.size) return;
  const snapshot = await readSnapshot();
  await writeSnapshot(changedSnapshot(snapshot, snapshot.lines.filter((line) => !removed.has(line.id))));
  announceUpdate();
}

export async function saveLocalTransportType(type: Record<string, unknown>): Promise<void> {
  const id = String(type.id ?? '');
  if (!id) throw new Error('Cannot cache a transport type without an id');
  const snapshot = await readSnapshot();
  const existing = snapshot.types.some((item) => item.id === id);
  const types = existing
    ? snapshot.types.map((item) => item.id === id ? { ...item, ...type } as SnapshotType : item)
    : [...snapshot.types, type as SnapshotType];
  await writeSnapshot({ ...changedSnapshot(snapshot, snapshot.lines), types });
  announceUpdate();
}
