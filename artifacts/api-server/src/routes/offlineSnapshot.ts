import { Router } from "express";
import { db, transportTypesTable, transitLinesTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { deriveRouteQuality } from "../engine/routeQuality";

const router = Router();
// v3 adds route-quality metadata (dataSource/sourcePriority/confidenceScore/
// routeStatus/...) and the manifest+delta sync model.
const SNAPSHOT_VERSION = 3;
const MAX_ROUTE_POINTS = 120;

function roundCoord(value: number): number {
  return Math.round(value * 100000) / 100000;
}

function compactPath(path: [number, number][] | null | undefined): [number, number][] | null {
  if (!path || path.length < 2) return null;
  const step = Math.max(1, Math.ceil(path.length / MAX_ROUTE_POINTS));
  const out: [number, number][] = [];
  for (let i = 0; i < path.length; i += step) {
    const p = path[i];
    if (Number.isFinite(p?.[0]) && Number.isFinite(p?.[1])) out.push([roundCoord(p[0]), roundCoord(p[1])]);
  }
  const last = path[path.length - 1];
  const compactLast: [number, number] = [roundCoord(last[0]), roundCoord(last[1])];
  const prev = out[out.length - 1];
  if (!prev || prev[0] !== compactLast[0] || prev[1] !== compactLast[1]) out.push(compactLast);
  return out.length >= 2 ? out : null;
}

function stampOf(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

type LineRow = typeof transitLinesTable.$inferSelect;
type TypeRow = typeof transportTypesTable.$inferSelect;

// A route is publishable to devices when it is active OR explicitly flagged
// needs_review (still shown, but ranked lower with a trust badge). Inactive /
// pending_discovery routes never reach the rider planner.
function isPublishable(line: LineRow): boolean {
  if (!line.isActive) return false;
  const status = line.routeStatus ?? "active";
  return status === "active" || status === "needs_review";
}

function toSnapshotType(t: TypeRow) {
  return {
    id: t.id,
    nameEn: t.nameEn,
    nameAr: t.nameAr,
    icon: t.icon,
    color: t.color,
    category: t.category,
    governmentType: t.governmentType,
    averageSpeedKmh: t.averageSpeedKmh,
    basePriceEgp: t.basePriceEgp,
    pricePerKmEgp: t.pricePerKmEgp,
  };
}

function toSnapshotLine(l: LineRow) {
  const path = l.routePath?.coordinates ?? null;
  const quality = deriveRouteQuality({
    dataSource: l.dataSource,
    routeStatus: l.routeStatus,
    confidenceScore: l.confidenceScore,
    reviewReportCount: l.reviewReportCount,
    verifiedAt: l.verifiedAt,
    lastConfirmedAt: l.lastConfirmedAt,
    hasFixedStops: l.hasFixedStops,
    lineNumber: l.lineNumber,
    path,
    pathPointCount: path?.length ?? 0,
  });
  return {
    id: l.id,
    transportTypeId: l.transportTypeId,
    lineNumber: l.lineNumber,
    nameEn: l.nameEn,
    nameAr: l.nameAr,
    fromArea: l.fromArea,
    toArea: l.toArea,
    governorate: l.governorate,
    viaStops: l.viaStops ?? [],
    stops: l.stops ?? null,
    path: compactPath(path),
    pathPointCount: path?.length ?? 0,
    priceEgp: l.priceEgp,
    frequencyMinutes: l.frequencyMinutes,
    hasFixedStops: l.hasFixedStops,
    // Route-quality metadata consumed by the on-device planner scoring.
    dataSource: quality.dataSource,
    sourcePriority: quality.sourcePriority,
    confidenceScore: quality.confidenceScore,
    routeStatus: quality.routeStatus,
    pathSuspect: quality.pathSuspect,
    verifiedAt: quality.verifiedAt,
    lastConfirmedAt: quality.lastConfirmedAt,
    reviewReportCount: quality.reviewReportCount,
    qualityAgeDays: quality.ageDays,
    updatedAt: l.updatedAt,
    revision: stampOf(l.updatedAt),
  };
}

function revisionOf(typeRows: TypeRow[], lineRows: LineRow[]): { revision: string; newest: number } {
  const newest = Math.max(
    0,
    ...typeRows.map((t) => stampOf(t.createdAt)),
    ...lineRows.map((l) => stampOf(l.updatedAt)),
  );
  return { revision: `${SNAPSHOT_VERSION}-${newest}`, newest };
}

async function loadRows(): Promise<{ typeRows: TypeRow[]; lineRows: LineRow[] }> {
  const [typeRows, lineRows] = await Promise.all([
    db.select().from(transportTypesTable).where(eq(transportTypesTable.isActive, true)).orderBy(asc(transportTypesTable.nameEn)),
    db.select().from(transitLinesTable).orderBy(asc(transitLinesTable.lineNumber)),
  ]);
  return { typeRows, lineRows };
}

// Full route-data snapshot for the mobile on-device planner. Contains no secrets
// and no user data: only active transport types and publishable line geometry +
// route-quality metadata. Kept for back-compat with installed clients.
router.get("/snapshot", async (_req, res) => {
  const { typeRows, lineRows } = await loadRows();
  const types = typeRows.map(toSnapshotType);
  const lines = lineRows
    .filter(isPublishable)
    .map(toSnapshotLine)
    .filter((l) => l.path && l.path.length >= 2);
  const { revision } = revisionOf(typeRows, lineRows);

  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
  res.json({
    schemaVersion: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    revision,
    types,
    lines,
  });
});

// Lightweight manifest: revision + transport types (small, always sent) + a
// per-line revision index so a device can decide exactly which lines changed and
// request only those via /delta. No geometry is included here.
router.get("/manifest", async (_req, res) => {
  const { typeRows, lineRows } = await loadRows();
  const types = typeRows.map(toSnapshotType);
  const publishable = lineRows.filter(isPublishable);
  const { revision, newest } = revisionOf(typeRows, lineRows);

  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=86400");
  res.json({
    schemaVersion: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    revision,
    newestRevision: newest,
    typeCount: types.length,
    lineCount: publishable.length,
    types,
    // Index used for delta planning: [lineId, lineRevision] for every publishable line.
    lineIndex: publishable.map((l) => [l.id, stampOf(l.updatedAt)] as [string, number]),
  });
});

// Delta sync: returns lines changed since the supplied revision plus the ids of
// lines that should be removed locally (deactivated or no longer publishable).
// `sinceRevision` accepts a raw millisecond timestamp or a `${version}-${ms}`
// revision string. A device with no/older schema gets a full payload.
router.get("/delta", async (req, res) => {
  const raw = String(req.query.sinceRevision ?? "").trim();
  const parsedMs = raw.includes("-") ? Number(raw.split("-").slice(-1)[0]) : Number(raw);
  const sinceVersion = raw.includes("-") ? Number(raw.split("-")[0]) : SNAPSHOT_VERSION;
  // Force a full resync when the schema version changed or the marker is unusable.
  const since = sinceVersion === SNAPSHOT_VERSION && Number.isFinite(parsedMs) ? parsedMs : 0;

  const { typeRows, lineRows } = await loadRows();
  const types = typeRows.map(toSnapshotType);
  const { revision, newest } = revisionOf(typeRows, lineRows);

  const changedLines = lineRows
    .filter(isPublishable)
    .filter((l) => stampOf(l.updatedAt) > since)
    .map(toSnapshotLine)
    .filter((l) => l.path && l.path.length >= 2);

  const removedLineIds = lineRows
    .filter((l) => !isPublishable(l) && stampOf(l.updatedAt) > since)
    .map((l) => l.id);

  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=86400");
  res.json({
    schemaVersion: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    revision,
    newestRevision: newest,
    since,
    full: since === 0,
    types,
    changedLines,
    removedLineIds,
  });
});

export default router;
