import { Router } from "express";
import { db, transportHeatmapsTable, transportTypesTable, transitLinesTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";

const router = Router();
const SNAPSHOT_VERSION = 3;
const MAX_ROUTE_POINTS = 120;
const PATH_SUSPECT_STEP_KM = 0.5;
const ACCEPTED_ROUTE_STATUSES = new Set(["active", "needs_review"]);

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

function haversineKm(a: [number, number], b: [number, number]): number {
  const r = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function maxConsecutiveStepKm(path: [number, number][] | null | undefined): number {
  if (!path || path.length < 2) return 0;
  let max = 0;
  for (let i = 1; i < path.length; i++) max = Math.max(max, haversineKm(path[i - 1], path[i]));
  return max;
}

function routeQuality(path: [number, number][] | null | undefined, hasFixedStops: boolean): "gtfs" | "standard" | "suspect" {
  if (!path || path.length < 2) return "suspect";
  if (maxConsecutiveStepKm(path) > PATH_SUSPECT_STEP_KM) return "suspect";
  return hasFixedStops || path.length >= 50 ? "gtfs" : "standard";
}

function stampOf(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function sourcePriority(source: string | null | undefined, stored: number | null | undefined): number {
  const normalized = (source || "").toLowerCase();
  if (normalized === "discovery") return 40;
  if (normalized === "gtfs") return 30;
  if (normalized === "admin") return 20;
  if (normalized === "csv" || normalized === "seed") return 10;
  return stored ?? 10;
}

function revisionOf(typeRows: { createdAt: unknown }[], lineRows: { updatedAt: unknown }[], heatRows: { createdAt: unknown }[]): string {
  const newest = Math.max(
    0,
    ...typeRows.map((t) => stampOf(t.createdAt)),
    ...lineRows.map((l) => stampOf(l.updatedAt)),
    ...heatRows.map((h) => stampOf(h.createdAt)),
  );
  return `${SNAPSHOT_VERSION}-${newest}-${typeRows.length}-${lineRows.length}-${heatRows.length}`;
}

function revisionStamp(revision: unknown): number {
  if (typeof revision !== "string") return 0;
  const stamp = Number(revision.split("-")[1]);
  return Number.isFinite(stamp) ? stamp : 0;
}

async function buildOfflinePayload(sinceRevision?: string) {
  const sinceMs = revisionStamp(sinceRevision);
  const [typeRows, allLineRows, heatRows] = await Promise.all([
    db.select().from(transportTypesTable).where(eq(transportTypesTable.isActive, true)).orderBy(asc(transportTypesTable.nameEn)),
    db.select().from(transitLinesTable).where(eq(transitLinesTable.isActive, true)).orderBy(asc(transitLinesTable.lineNumber)),
    db.select().from(transportHeatmapsTable).orderBy(asc(transportHeatmapsTable.transportTypeId)),
  ]);
  const acceptedLineRows = allLineRows.filter((l) => ACCEPTED_ROUTE_STATUSES.has(l.routeStatus ?? "active"));
  const lineRows = sinceMs > 0
    ? acceptedLineRows.filter((l) => stampOf(l.updatedAt) > sinceMs)
    : acceptedLineRows;

  const types = typeRows.map((t) => ({
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
  }));

  const lines = lineRows
    .map((l) => {
      const path = l.routePath?.coordinates ?? null;
      const compactedPath = compactPath(path);
      const status = l.routeStatus ?? "active";
      const dataSource = l.dataSource ?? (l.hasFixedStops ? "gtfs" : "seed");
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
        path: compactedPath,
        pathPointCount: path?.length ?? 0,
        pathSuspect: maxConsecutiveStepKm(path) > PATH_SUSPECT_STEP_KM,
        routeQuality: routeQuality(path, l.hasFixedStops),
        routeQualityDetails: l.routeQuality ?? null,
        activeGeometryVersionId: l.activeGeometryVersionId,
        geometryLocked: l.geometryLocked,
        dataSource,
        sourcePriority: sourcePriority(dataSource, l.sourcePriority),
        confidenceScore: l.confidenceScore ?? (status === "needs_review" ? 0.45 : 0.7),
        routeStatus: status,
        verifiedAt: l.verifiedAt,
        lastConfirmedAt: l.lastConfirmedAt,
        needsReviewReason: l.needsReviewReason,
        reviewReportCount: l.reviewReportCount ?? 0,
        priceEgp: l.priceEgp,
        frequencyMinutes: l.frequencyMinutes,
        observedSpeedKmh: l.observedSpeedKmh,
        hasFixedStops: l.hasFixedStops,
        updatedAt: l.updatedAt,
      };
    })
    .filter((l) => l.path && l.path.length >= 2);

  const heatmaps = heatRows.map((h) => ({
    id: h.id,
    transportTypeId: h.transportTypeId,
    latitude: h.latitude,
    longitude: h.longitude,
    intensity: h.intensity,
    radiusKm: h.radiusKm,
    createdAt: h.createdAt,
  }));

  return {
    schemaVersion: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    revision: revisionOf(typeRows, acceptedLineRows, heatRows),
    types,
    lines,
    heatmaps,
  };
}

// Manifest is intentionally tiny: the app uses it to decide whether it needs a delta.
router.get("/manifest", async (_req, res) => {
  const payload = await buildOfflinePayload();
  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
  res.json({
    schemaVersion: payload.schemaVersion,
    generatedAt: payload.generatedAt,
    revision: payload.revision,
    counts: {
      types: payload.types.length,
      lines: payload.lines.length,
      heatmaps: payload.heatmaps.length,
    },
    deltaUrl: "/api/offline/delta",
  });
});

router.get("/delta", async (req, res) => {
  const sinceRevision = typeof req.query.sinceRevision === "string" ? req.query.sinceRevision : undefined;
  const payload = await buildOfflinePayload(sinceRevision);
  res.setHeader("Cache-Control", "public, max-age=120, stale-while-revalidate=86400");
  res.json(payload);
});

// Backwards-compatible full snapshot for older mobile builds.
router.get("/snapshot", async (_req, res) => {
  const payload = await buildOfflinePayload();
  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
  res.json(payload);
});

export default router;
