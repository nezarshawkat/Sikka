import bundledSnapshotRaw from '@/data/bundledSnapshot.json';

type SnapshotLine = Record<string, unknown> & { id: string; transportTypeId: string; path?: [number, number][]; routeStatus?: string };
type SnapshotType = Record<string, unknown> & { id: string };
type OfflineSnapshot = {
  schemaVersion: number;
  generatedAt: string;
  revision: string;
  types: SnapshotType[];
  lines: SnapshotLine[];
  heatmaps?: unknown[];
};

const bundledSnapshot = bundledSnapshotRaw as unknown as OfflineSnapshot;
const DB_NAME = 'sikka-offline';
const STORE_NAME = 'snapshots';
const SNAPSHOT_KEY = 'latest';
export const ROUTES_UPDATED_EVENT = 'sikka:routes-updated';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ snapshot, savedAt: Date.now() }, SNAPSHOT_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function readSnapshot(): Promise<OfflineSnapshot> {
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
    if (stored?.snapshot && Array.isArray(stored.snapshot.lines)) {
      const bundledTime = Date.parse(bundledSnapshot.generatedAt) || 0;
      const cachedTime = Date.parse(stored.snapshot.generatedAt) || 0;
      return bundledTime > cachedTime ? bundledSnapshot : stored.snapshot;
    }
  } catch {
    // Use the bundled snapshot when IndexedDB is unavailable.
  }
  await writeSnapshot(bundledSnapshot);
  return bundledSnapshot;
}

function toUiLine(line: SnapshotLine): Record<string, unknown> {
  const path = Array.isArray(line.path) ? line.path : [];
  return {
    ...line,
    routePath: path.length >= 2 ? { type: 'LineString', coordinates: path } : null,
    isActive: line.routeStatus !== 'inactive' && line.routeStatus !== 'pending_discovery',
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
