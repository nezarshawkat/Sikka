import { Router } from "express";
import { db, transportTypesTable, transitLinesTable } from "@workspace/db";
import { asc, eq, gt } from "drizzle-orm";

const router = Router();
const SNAPSHOT_VERSION = 3;
const MAX_ROUTE_POINTS = 2000;
const SIMPLIFY_TOLERANCE_KM = 0.006;
const PATH_SUSPECT_STEP_KM = 0.5;
const PATH_POOR_STEP_KM = 0.18;

function roundCoord(value: number): number {
  return Math.round(value * 100000) / 100000;
}

function pointToSegmentKm(point: [number, number], a: [number, number], b: [number, number]): number {
  const r = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (d: number) => (d * 180) / Math.PI;
  const cosLat = Math.max(Math.cos(toRad(point[1])), 0.000001);
  const ax = toRad(a[0] - point[0]) * cosLat * r;
  const ay = toRad(a[1] - point[1]) * r;
  const bx = toRad(b[0] - point[0]) * cosLat * r;
  const by = toRad(b[1] - point[1]) * r;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (-ax * dx + -ay * dy) / len2)) : 0;
  const px = ax + dx * t;
  const py = ay + dy * t;
  return haversineKm(point, [point[0] + toDeg(px / (cosLat * r)), point[1] + toDeg(py / r)]);
}

function simplifyDouglasPeucker(path: [number, number][], toleranceKm: number): [number, number][] {
  if (path.length <= 2) return path;
  let maxDistance = 0;
  let index = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const distance = pointToSegmentKm(path[i], path[0], path[path.length - 1]);
    if (distance > maxDistance) {
      index = i;
      maxDistance = distance;
    }
  }
  if (maxDistance <= toleranceKm) return [path[0], path[path.length - 1]];
  const left = simplifyDouglasPeucker(path.slice(0, index + 1), toleranceKm);
  const right = simplifyDouglasPeucker(path.slice(index), toleranceKm);
  return left.slice(0, -1).concat(right);
}

function cleanPath(path: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of path) {
    if (!Number.isFinite(p?.[0]) || !Number.isFinite(p?.[1])) continue;
    const rounded: [number, number] = [roundCoord(p[0]), roundCoord(p[1])];
    const prev = out[out.length - 1];
    if (!prev || haversineKm(prev, rounded) >= 0.003) out.push(rounded);
  }
  return out;
}

function compactPath(path: [number, number][] | null | undefined): [number, number][] | null {
  if (!path || path.length < 2) return null;
  const cleaned = cleanPath(path);
  if (cleaned.length < 2) return null;
  let out = cleaned.length <= MAX_ROUTE_POINTS ? cleaned : simplifyDouglasPeucker(cleaned, SIMPLIFY_TOLERANCE_KM);
  let tolerance = SIMPLIFY_TOLERANCE_KM;
  while (out.length > MAX_ROUTE_POINTS && tolerance < 0.05) {
    tolerance *= 1.35;
    out = simplifyDouglasPeucker(cleaned, tolerance);
  }
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

function routeQuality(path: [number, number][] | null | undefined, hasFixedStops: boolean, source?: string | null): "gtfs" | "discovered" | "recorded" | "standard" | "rough" | "suspect" {
  if (!path || path.length < 2) return "suspect";
  const maxStepKm = maxConsecutiveStepKm(path);
  if (maxStepKm > PATH_SUSPECT_STEP_KM) return "suspect";
  if (maxStepKm > PATH_POOR_STEP_KM) return "rough";
  if (source === "discovered") return "discovered";
  if (hasFixedStops) return "gtfs";
  return path.length >= 50 ? "recorded" : "standard";
}

function stampOf(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

// Public route-data snapshot for the mobile on-device planner. This contains no
// secrets and no user data: only active transport types and active line geometry.
router.get("/snapshot", async (_req, res) => {
  const [typeRows, lineRows] = await Promise.all([
    db.select().from(transportTypesTable).where(eq(transportTypesTable.isActive, true)).orderBy(asc(transportTypesTable.nameEn)),
    db.select().from(transitLinesTable).where(eq(transitLinesTable.isActive, true)).orderBy(asc(transitLinesTable.lineNumber)),
  ]);

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
      const rawPath = l.routePath?.coordinates ?? null;
      const source = (l.routePath as { source?: string } | null | undefined)?.source ?? null;
      const path = compactPath(rawPath);
      const maxStepKm = maxConsecutiveStepKm(path);
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
        path,
        pathPointCount: rawPath?.length ?? 0,
        snapshotPointCount: path?.length ?? 0,
        maxStepMeters: Math.round(maxStepKm * 1000),
        pathSuspect: maxStepKm > PATH_SUSPECT_STEP_KM,
        routeQuality: routeQuality(path, l.hasFixedStops, source),
        source,
        priceEgp: l.priceEgp,
        frequencyMinutes: l.frequencyMinutes,
        hasFixedStops: l.hasFixedStops,
        updatedAt: l.updatedAt,
      };
    })
    .filter((l) => l.path && l.path.length >= 2);

  const newest = Math.max(
    0,
    ...typeRows.map((t) => stampOf(t.createdAt)),
    ...lineRows.map((l) => stampOf(l.updatedAt)),
  );

  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
  res.json({
    schemaVersion: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    revision: `${SNAPSHOT_VERSION}-${newest}-${types.length}-${lines.length}`,
    types,
    lines,
  });
});

router.get("/manifest", async (_req, res) => {
  const [typeRows, lineRows] = await Promise.all([
    db.select().from(transportTypesTable).where(eq(transportTypesTable.isActive, true)),
    db.select().from(transitLinesTable).where(eq(transitLinesTable.isActive, true)),
  ]);
  const newest = Math.max(
    0,
    ...typeRows.map((t) => stampOf(t.createdAt)),
    ...lineRows.map((l) => stampOf(l.updatedAt)),
  );
  res.setHeader("Cache-Control", "public, max-age=120, stale-while-revalidate=3600");
  res.json({
    schemaVersion: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    revision: `${SNAPSHOT_VERSION}-${newest}-${typeRows.length}-${lineRows.length}`,
    latestStamp: newest,
    counts: { types: typeRows.length, lines: lineRows.length },
  });
});

router.get("/changes", async (req, res) => {
  const since = Number(req.query.since ?? 0);
  const sinceDate = Number.isFinite(since) && since > 0 ? new Date(since) : new Date(0);
  const [typeRows, lineRows] = await Promise.all([
    db.select().from(transportTypesTable).where(eq(transportTypesTable.isActive, true)).orderBy(asc(transportTypesTable.nameEn)),
    db.select().from(transitLinesTable).where(gt(transitLinesTable.updatedAt, sinceDate)).orderBy(asc(transitLinesTable.updatedAt)),
  ]);

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
      const rawPath = l.routePath?.coordinates ?? null;
      const source = (l.routePath as { source?: string } | null | undefined)?.source ?? null;
      const path = compactPath(rawPath);
      const maxStepKm = maxConsecutiveStepKm(path);
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
        path,
        pathPointCount: rawPath?.length ?? 0,
        snapshotPointCount: path?.length ?? 0,
        maxStepMeters: Math.round(maxStepKm * 1000),
        pathSuspect: maxStepKm > PATH_SUSPECT_STEP_KM,
        routeQuality: routeQuality(path, l.hasFixedStops, source),
        source,
        priceEgp: l.priceEgp,
        frequencyMinutes: l.frequencyMinutes,
        hasFixedStops: l.hasFixedStops,
        updatedAt: l.updatedAt,
        deleted: !l.isActive,
      };
    })
    .filter((l) => l.deleted || (l.path && l.path.length >= 2));

  const newest = Math.max(since, ...lineRows.map((l) => stampOf(l.updatedAt)));
  res.setHeader("Cache-Control", "no-cache");
  res.json({
    schemaVersion: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    revision: `${SNAPSHOT_VERSION}-${newest}-${types.length}-${lines.length}`,
    latestStamp: newest,
    types,
    lines,
  });
});

export default router;
