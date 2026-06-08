import { Router } from "express";
import { db, transportTypesTable, transitLinesTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";

const router = Router();
const SNAPSHOT_VERSION = 1;
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
    .map((l) => ({
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
      path: compactPath(l.routePath?.coordinates ?? null),
      priceEgp: l.priceEgp,
      frequencyMinutes: l.frequencyMinutes,
      hasFixedStops: l.hasFixedStops,
      updatedAt: l.updatedAt,
    }))
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

export default router;
