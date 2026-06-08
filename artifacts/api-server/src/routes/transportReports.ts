import { Router } from "express";
import { db } from "@workspace/db";
import { transportReportsTable, transitLinesTable } from "@workspace/db";
import { eq, desc, and, inArray, sql, type SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { invalidateGraph } from "../engine/graph.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUSES = ["pending", "approved", "rejected"];
const MIN_DISCOVERY_REPORTS = 4;
const MIN_TRACE_POINTS = 6;
const TRACE_JOIN_KM = 0.35;
const SAME_PATH_KM = 0.22;
const NUMBER_REFRESH_DAYS = 122; // about four months

type TracePoint = [number, number];
type ReportClusterRow = {
  id: string;
  transportName: string;
  transportNumber: string | null;
  transportTypeId: string | null;
  fromArea: string | null;
  toArea: string | null;
  gpsTrace: TracePoint[] | null;
  priceEgp: number | null;
  createdAt: Date;
};

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isMicrobusName(value: string): boolean {
  return /microbus|ميكروباص/i.test(value);
}

function isBusName(value: string): boolean {
  return /bus|أتوبيس|اتوبيس/i.test(value) && !isMicrobusName(value);
}

function sanitizeTrace(input: unknown): TracePoint[] | null {
  if (!Array.isArray(input)) return null;
  const out: TracePoint[] = [];
  for (const item of input) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const lng = Number(item[0]);
    const lat = Number(item[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const pt: TracePoint = [lng, lat];
    const prev = out[out.length - 1];
    if (!prev || pointKm(prev, pt) >= 0.02) out.push(pt);
  }
  return out.length >= MIN_TRACE_POINTS ? out : null;
}

function pointKm(a: TracePoint, b: TracePoint): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function traceKm(trace: TracePoint[]): number {
  let km = 0;
  for (let i = 1; i < trace.length; i++) km += pointKm(trace[i - 1], trace[i]);
  return km;
}

function nearestIndex(path: TracePoint[], p: TracePoint): { index: number; km: number } {
  let index = 0;
  let km = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = pointKm(path[i], p);
    if (d < km) {
      km = d;
      index = i;
    }
  }
  return { index, km };
}

function orientLikeBase(trace: TracePoint[], base: TracePoint[]): TracePoint[] {
  if (base.length < 2 || trace.length < 2) return trace;
  const forward =
    pointKm(base[0], trace[0]) +
    pointKm(base[base.length - 1], trace[trace.length - 1]);
  const reverse =
    pointKm(base[0], trace[trace.length - 1]) +
    pointKm(base[base.length - 1], trace[0]);
  return reverse < forward ? [...trace].reverse() : trace;
}

function mergeOneTrace(base: TracePoint[], trace: TracePoint[]): { path: TracePoint[]; changed: boolean } {
  if (base.length < 2) return { path: trace, changed: true };
  const oriented = orientLikeBase(trace, base);
  const first = oriented[0];
  const last = oriented[oriented.length - 1];
  const baseFirst = base[0];
  const baseLast = base[base.length - 1];

  if (pointKm(baseLast, first) <= TRACE_JOIN_KM) {
    return { path: simplifyTrace(base.concat(oriented.slice(1))), changed: true };
  }
  if (pointKm(baseFirst, last) <= TRACE_JOIN_KM) {
    return { path: simplifyTrace(oriented.concat(base.slice(1))), changed: true };
  }

  const nearStart = nearestIndex(base, first);
  const nearEnd = nearestIndex(base, last);
  if (nearStart.km <= TRACE_JOIN_KM && nearEnd.km <= TRACE_JOIN_KM) {
    return { path: base, changed: false };
  }
  if (nearStart.km <= TRACE_JOIN_KM && nearStart.index >= base.length * 0.65) {
    return { path: simplifyTrace(base.slice(0, nearStart.index + 1).concat(oriented.slice(1))), changed: true };
  }
  if (nearEnd.km <= TRACE_JOIN_KM && nearEnd.index <= base.length * 0.35) {
    return { path: simplifyTrace(oriented.slice(0, -1).concat(base.slice(nearEnd.index))), changed: true };
  }

  return { path: base, changed: false };
}

function simplifyTrace(trace: TracePoint[]): TracePoint[] {
  if (trace.length <= 2) return trace;
  const out: TracePoint[] = [trace[0]];
  for (let i = 1; i < trace.length - 1; i++) {
    if (pointKm(out[out.length - 1], trace[i]) >= 0.035) out.push(trace[i]);
  }
  const last = trace[trace.length - 1];
  if (pointKm(out[out.length - 1], last) >= 0.02) out.push(last);
  return out.length >= 2 ? out : trace;
}

function stitchPartialTraces(traces: TracePoint[][]): TracePoint[] | null {
  const ordered = traces
    .map((trace) => simplifyTrace(trace))
    .filter((trace) => trace.length >= MIN_TRACE_POINTS)
    .sort((a, b) => traceKm(b) - traceKm(a));
  if (!ordered.length) return null;

  let base = ordered[0];
  let changed = true;
  let guard = 0;
  while (changed && guard < 4) {
    changed = false;
    guard++;
    for (const trace of ordered.slice(1)) {
      const merged = mergeOneTrace(base, trace);
      if (merged.changed) {
        base = merged.path;
        changed = true;
      }
    }
  }
  return base.length >= MIN_TRACE_POINTS ? base : null;
}

function samplePath(path: TracePoint[], count = 12): TracePoint[] {
  if (path.length <= count) return path;
  const out: TracePoint[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i / (count - 1)) * (path.length - 1));
    out.push(path[idx]);
  }
  return out;
}

function samePath(a: TracePoint[], b: TracePoint[]): boolean {
  if (a.length < 2 || b.length < 2) return false;
  const sameDirection =
    pointKm(a[0], b[0]) + pointKm(a[a.length - 1], b[b.length - 1]);
  const reverseDirection =
    pointKm(a[0], b[b.length - 1]) + pointKm(a[a.length - 1], b[0]);
  const bOriented = reverseDirection < sameDirection ? [...b].reverse() : b;
  if (pointKm(a[0], bOriented[0]) > TRACE_JOIN_KM) return false;
  if (pointKm(a[a.length - 1], bOriented[bOriented.length - 1]) > TRACE_JOIN_KM) return false;
  const samples = samplePath(a);
  const avg = samples.reduce((sum, p) => sum + nearestIndex(bOriented, p).km, 0) / samples.length;
  return avg <= SAME_PATH_KM;
}

function splitLineNumbers(lineNumber: string | null | undefined): string[] {
  return (lineNumber ?? "")
    .split(/\s*(?:\/|,|\bor\b)\s*/i)
    .map((n) => n.trim())
    .filter(Boolean);
}

function joinLineNumbers(numbers: string[]): string | null {
  const clean = [...new Set(numbers.map((n) => n.trim()).filter(Boolean))];
  return clean.length ? clean.join(" or ") : null;
}

function consensusText(rows: ReportClusterRow[], field: "fromArea" | "toArea"): string | null {
  const counts = new Map<string, { label: string; count: number }>();
  for (const row of rows) {
    const value = row[field]?.trim();
    if (!value) continue;
    const key = norm(value);
    const current = counts.get(key);
    counts.set(key, { label: current?.label ?? value, count: (current?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.label ?? null;
}

function labelClosestToPathEnd(rows: ReportClusterRow[], path: TracePoint[], field: "fromArea" | "toArea", end: "start" | "finish"): string | null {
  const target = end === "start" ? path[0] : path[path.length - 1];
  let best: { label: string; km: number } | null = null;
  for (const row of rows) {
    const trace = sanitizeTrace(row.gpsTrace);
    const label = row[field]?.trim();
    if (!trace || !label) continue;
    const point = end === "start" ? trace[0] : trace[trace.length - 1];
    const km = pointKm(target, point);
    if (!best || km < best.km) best = { label, km };
  }
  return best?.label ?? null;
}

function recentNumberIsDominant(number: string, rows: ReportClusterRow[]): boolean {
  const cutoff = Date.now() - NUMBER_REFRESH_DAYS * 24 * 60 * 60 * 1000;
  const recent = rows.filter((r) => new Date(r.createdAt).getTime() >= cutoff && r.transportNumber?.trim());
  const total = recent.length;
  const count = recent.filter((r) => norm(r.transportNumber) === norm(number)).length;
  return count >= 3 && count >= Math.ceil(total / 2);
}

async function promoteDiscoveredRoute(params: {
  transportName: string;
  transportNumber: string | null;
  transportTypeId: string | null;
  fromArea: string | null;
  toArea: string | null;
}) {
  const baseFilters: SQL[] = [sql`${transportReportsTable.gpsTrace} is not null`];
  if (params.transportTypeId) {
    baseFilters.push(eq(transportReportsTable.transportTypeId, params.transportTypeId));
  } else {
    baseFilters.push(sql`lower(${transportReportsTable.transportName}) = ${norm(params.transportName)}`);
  }

  const rows = await db
    .select({
      id: transportReportsTable.id,
      transportName: transportReportsTable.transportName,
      transportNumber: transportReportsTable.transportNumber,
      transportTypeId: transportReportsTable.transportTypeId,
      fromArea: transportReportsTable.fromArea,
      toArea: transportReportsTable.toArea,
      gpsTrace: transportReportsTable.gpsTrace,
      priceEgp: transportReportsTable.priceEgp,
      createdAt: transportReportsTable.createdAt,
    })
    .from(transportReportsTable)
    .where(and(...baseFilters));

  const isMicrobus = isMicrobusName(params.transportName);
  const isBus = isBusName(params.transportName);
  const wantedNumber = norm(params.transportNumber);
  const wantedFrom = norm(params.fromArea);
  const wantedTo = norm(params.toArea);

  const candidates = (rows as ReportClusterRow[]).filter((row) => {
    const trace = sanitizeTrace(row.gpsTrace);
    if (!trace) return false;
    if (isMicrobus) {
      const rowTo = norm(row.toArea);
      return !!wantedTo ? rowTo === wantedTo : norm(row.fromArea) === wantedFrom && rowTo === wantedTo;
    }
    if (isBus) {
      return (!!wantedNumber && norm(row.transportNumber) === wantedNumber)
        || (!!wantedFrom && !!wantedTo && norm(row.fromArea) === wantedFrom && norm(row.toArea) === wantedTo);
    }
    return norm(row.fromArea) === wantedFrom && norm(row.toArea) === wantedTo;
  });

  if (candidates.length < MIN_DISCOVERY_REPORTS || !params.transportTypeId) return;

  const traces = candidates.map((row) => sanitizeTrace(row.gpsTrace)).filter((trace): trace is TracePoint[] => !!trace);
  const path = stitchPartialTraces(traces);
  if (!path || traceKm(path) < 0.5) return;

  const fromArea =
    labelClosestToPathEnd(candidates, path, "fromArea", "start")
    ?? consensusText(candidates, "fromArea")
    ?? params.fromArea
    ?? "Discovered start";
  const toArea =
    consensusText(candidates, "toArea")
    ?? labelClosestToPathEnd(candidates, path, "toArea", "finish")
    ?? params.toArea
    ?? "Discovered end";
  const avgPrice = candidates
    .map((row) => row.priceEgp)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p))
    .reduce((sum, p, _i, arr) => sum + p / arr.length, 0);
  const currentNumbers = isBus && params.transportNumber ? [params.transportNumber] : [];

  const existingLines = await db
    .select({
      id: transitLinesTable.id,
      lineNumber: transitLinesTable.lineNumber,
      routePath: transitLinesTable.routePath,
      nameEn: transitLinesTable.nameEn,
    })
    .from(transitLinesTable)
    .where(eq(transitLinesTable.transportTypeId, params.transportTypeId));

  const samePathReports = (rows as ReportClusterRow[]).filter((row) => {
    const trace = sanitizeTrace(row.gpsTrace);
    return !!trace && samePath(path, trace);
  });

  const match = existingLines.find((line) => {
    const coords = (line.routePath?.coordinates ?? null) as TracePoint[] | null;
    return !!coords && samePath(path, coords);
  });

  const lineNumber = (() => {
    if (!isBus) return null;
    const existing = splitLineNumbers(match?.lineNumber);
    const next = [...existing];
    for (const num of currentNumbers) {
      if (match && !recentNumberIsDominant(num, samePathReports)) continue;
      next.push(num);
    }
    return joinLineNumbers(next.length ? next : currentNumbers);
  })();

  const routeName = isMicrobus
    ? `${fromArea} → ${toArea}`
    : `${params.transportName}${lineNumber ? ` ${lineNumber}` : ""}: ${fromArea} → ${toArea}`;
  const routePath = { type: "LineString", coordinates: path };
  const priceEgp = Number.isFinite(avgPrice) && avgPrice > 0 ? avgPrice : isMicrobus ? 5 : 10;

  if (match) {
    const existingCoords = (match.routePath?.coordinates ?? []) as TracePoint[];
    await db
      .update(transitLinesTable)
      .set({
        lineNumber,
        nameEn: routeName,
        nameAr: routeName,
        fromArea,
        toArea,
        routePath: path.length > existingCoords.length ? routePath : match.routePath,
        priceEgp,
        hasFixedStops: false,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(transitLinesTable.id, match.id));
  } else {
    await db.insert(transitLinesTable).values({
      transportTypeId: params.transportTypeId,
      lineNumber,
      nameEn: routeName,
      nameAr: routeName,
      fromArea,
      toArea,
      governorate: "Cairo",
      viaStops: [],
      routePath,
      priceEgp,
      frequencyMinutes: isMicrobus ? 12 : 18,
      hasFixedStops: false,
      isActive: true,
    });
  }

  await db
    .update(transportReportsTable)
    .set({ status: "approved" })
    .where(inArray(transportReportsTable.id, candidates.map((row) => row.id)));
  invalidateGraph();
}

router.get("/", requireAdmin, async (req, res) => {
  const { discovery, status } = req.query as { discovery?: string; status?: string };

  if (discovery === "true") {
    const rows = await db
      .select({
        transportName: transportReportsTable.transportName,
        transportNumber: transportReportsTable.transportNumber,
        reportCount: sql<number>`cast(count(*) as int)`,
        sampleFromArea: sql<string | null>`max(${transportReportsTable.fromArea})`,
        sampleToArea: sql<string | null>`max(${transportReportsTable.toArea})`,
        avgPrice: sql<number | null>`avg(${transportReportsTable.priceEgp})`,
        gpsTraceCount: sql<number>`cast(sum(case when ${transportReportsTable.gpsTrace} is not null then 1 else 0 end) as int)`,
        avgGpsPoints: sql<number | null>`avg(jsonb_array_length(coalesce(${transportReportsTable.gpsTrace}, '[]'::jsonb)))`,
        confidenceScore: sql<number>`least(5, greatest(1, round((1 + least(count(*), 12) / 3.0 + least(avg(jsonb_array_length(coalesce(${transportReportsTable.gpsTrace}, '[]'::jsonb))), 120) / 60.0)::numeric, 1)))`,
        recommendationScore: sql<number>`cast(count(*) as int)`,
      })
      .from(transportReportsTable)
      .groupBy(
        sql`lower(${transportReportsTable.transportName})`,
        sql`coalesce(${transportReportsTable.transportNumber}, '')`,
        sql`lower(coalesce(${transportReportsTable.fromArea}, ''))`,
        sql`lower(coalesce(${transportReportsTable.toArea}, ''))`,
        transportReportsTable.transportName,
        transportReportsTable.transportNumber,
        transportReportsTable.fromArea,
        transportReportsTable.toArea,
      )
      .orderBy(desc(sql`count(*)`));
    return res.json(rows);
  }

  const filters: SQL[] = [];
  if (status && STATUSES.includes(status)) {
    filters.push(eq(transportReportsTable.status, status));
  }
  const rows = await db
    .select()
    .from(transportReportsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(transportReportsTable.createdAt));
  return res.json(rows);
});

router.post("/", requireAuth, async (req, res) => {
  const {
    transportName, transportNumber, transportTypeId, fromArea, toArea,
    gpsTrace, stopsVisited, priceEgp,
  } = req.body;

  if (typeof transportName !== "string" || !transportName.trim()) {
    return res.status(400).json({ error: "transportName is required" });
  }

  const resolvedTransportTypeId =
    typeof transportTypeId === "string" && UUID_RE.test(transportTypeId) ? transportTypeId : null;
  const price = Number(priceEgp);
  const cleanTransportName = transportName.trim();
  const cleanTransportNumber = typeof transportNumber === "string" && transportNumber.trim().length ? transportNumber.trim() : null;
  const cleanFromArea = typeof fromArea === "string" && fromArea.trim().length ? fromArea.trim() : null;
  const cleanToArea = typeof toArea === "string" && toArea.trim().length ? toArea.trim() : null;
  const cleanGpsTrace = sanitizeTrace(gpsTrace);
  const routeName = cleanTransportName.toLowerCase();
  const routeNumber = cleanTransportNumber ?? "";
  const routeFrom = (cleanFromArea ?? "").toLowerCase();
  const routeTo = (cleanToArea ?? "").toLowerCase();
  const sameRoute = and(
    sql`lower(${transportReportsTable.transportName}) = ${routeName}`,
    sql`coalesce(${transportReportsTable.transportNumber}, '') = ${routeNumber}`,
    sql`lower(coalesce(${transportReportsTable.fromArea}, '')) = ${routeFrom}`,
    sql`lower(coalesce(${transportReportsTable.toArea}, '')) = ${routeTo}`,
  );
  const [cluster] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(transportReportsTable)
    .where(sameRoute);
  const shouldAutoApprove = ((cluster?.count ?? 0) + 1) >= 10;

  const [row] = await db.insert(transportReportsTable).values({
    userId: req.userId!,
    transportName: cleanTransportName,
    transportNumber: cleanTransportNumber,
    transportTypeId: resolvedTransportTypeId,
    fromArea: cleanFromArea,
    toArea: cleanToArea,
    gpsTrace: cleanGpsTrace,
    stopsVisited: Array.isArray(stopsVisited) ? stopsVisited : null,
    priceEgp: Number.isFinite(price) ? price : null,
    status: shouldAutoApprove ? "approved" : "pending",
  }).returning();
  if (shouldAutoApprove) {
    await db.update(transportReportsTable).set({ status: "approved" }).where(sameRoute);
  }
  if (cleanGpsTrace) {
    await promoteDiscoveredRoute({
      transportName: cleanTransportName,
      transportNumber: cleanTransportNumber,
      transportTypeId: resolvedTransportTypeId,
      fromArea: cleanFromArea,
      toArea: cleanToArea,
    });
  }
  return res.json(row);
});

router.put("/:id", requireAdmin, async (req, res) => {
  const { status } = req.body;
  if (typeof status !== "string" || !STATUSES.includes(status)) {
    return res.status(400).json({ error: "invalid status" });
  }
  const [row] = await db
    .update(transportReportsTable)
    .set({ status })
    .where(eq(transportReportsTable.id, req.params.id as string))
    .returning();
  if (!row) return res.status(404).json({ error: "transport report not found" });
  return res.json(row);
});

export default router;
