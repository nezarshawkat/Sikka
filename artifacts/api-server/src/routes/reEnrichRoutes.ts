/**
 * Admin-triggered, incremental re-enrichment of board-anywhere route_path
 * geometry (bus / microbus / serfis — NOT metro/monorail/train).
 *
 * POST /api/admin/re-enrich-routes?transportMode=bus&limit=N&offset=M
 *
 * Designed for SMALL batches so a single request never runs long enough to hit
 * the proxy timeout. Each call:
 *   - selects board-anywhere lines ordered by id (deterministic, resumable),
 *   - optionally filters by transportMode (substring match on the type name),
 *   - applies offset/limit,
 *   - re-runs the AI-breadcrumb + driving-traffic pipeline per line,
 *   - writes route_path back ONLY when the new path is non-null with ≥10 coords
 *     (otherwise the old polyline is retained),
 *   - clears the in-memory graph cache so the next trip plan uses fresh geometry,
 *   - returns a JSON summary the caller can use to drive the next offset.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { transitLinesTable, transportTypesTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { buildBusRoutePathAI } from "../utils/busPathEnricher";
import { invalidateGraph } from "../engine/graph";

const MIN_COORDS = 10;        // never overwrite a good path with a sparse new one
const DEFAULT_LIMIT = 5;      // keep batches short to dodge proxy timeouts
const MAX_LIMIT = 25;
const MAX_STEP_KM = 0.75;
const ENDPOINT_TOLERANCE_KM = 1.2;

const router = Router();

function haversineKm(a: [number, number], b: [number, number]): number {
  const r = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function validateSnappedPath(oldPath: [number, number][] | null | undefined, path: [number, number][] | null | undefined): string | null {
  if (!path || path.length < MIN_COORDS) return "too_few_points";
  for (let i = 1; i < path.length; i++) {
    if (haversineKm(path[i - 1], path[i]) > MAX_STEP_KM) return "large_geometry_jump";
  }
  if (oldPath && oldPath.length >= 2) {
    if (haversineKm(oldPath[0], path[0]) > ENDPOINT_TOLERANCE_KM) return "start_endpoint_shifted";
    if (haversineKm(oldPath[oldPath.length - 1], path[path.length - 1]) > ENDPOINT_TOLERANCE_KM) return "end_endpoint_shifted";
  }
  return null;
}

router.post("/", requireAdmin, async (req, res) => {
  const transportMode =
    typeof req.query.transportMode === "string" ? req.query.transportMode.trim() : "";
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT),
  );
  const offset = Math.max(0, Number(req.query.offset) || 0);
  // CSV-imported rows are tagged dataSource="seed" in the DB (seedFromCSV.ts
  // never sets it explicitly, so it falls through to the schema default) —
  // "csv" is the colloquial name, not the stored value. Comma-separated list
  // supported, e.g. ?dataSource=seed,admin to also catch lines an earlier,
  // pre-fix run of this same endpoint already wrote a bad path into.
  const dataSourceParam =
    typeof req.query.dataSource === "string" ? req.query.dataSource.trim() : "";
  const dataSourceFilter = dataSourceParam
    ? new Set(dataSourceParam.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))
    : null;

  // Resolve type ids whose name matches transportMode (substring, case-insensitive).
  const types = await db.select().from(transportTypesTable);
  const typeName = new Map(types.map((t) => [t.id, t.nameEn]));
  let matchTypeIds: Set<string> | null = null;
  if (transportMode) {
    const needle = transportMode.toLowerCase();
    matchTypeIds = new Set(
      types.filter((t) => t.nameEn.toLowerCase().includes(needle)).map((t) => t.id),
    );
  }

  const allLines = await db
    .select()
    .from(transitLinesTable)
    .orderBy(asc(transitLinesTable.id));

  let targets = allLines.filter((l) => !l.hasFixedStops);
  if (matchTypeIds) targets = targets.filter((l) => matchTypeIds!.has(l.transportTypeId));
  if (dataSourceFilter) {
    // Explicit allow-list — only the requested source(s), e.g. "seed" alone.
    targets = targets.filter((l) => dataSourceFilter.has((l.dataSource || "seed").toLowerCase()));
  } else {
    // No filter given — still NEVER touch discovery-sourced lines by default.
    // Those carry real rider GPS, which is strictly better than anything this
    // synthetic geocode-and-snap pipeline could produce; silently overwriting
    // ground truth with a guess would be a regression, not an improvement.
    targets = targets.filter((l) => (l.dataSource || "seed").toLowerCase() !== "discovery");
  }

  const totalMatching = targets.length;
  const batch = targets.slice(offset, offset + limit);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const results: Array<{ id: string; line: string | null; status: string; coords?: number; droppedBacktrackCount?: number }> = [];

  for (const line of batch) {
    const gov = (line as { governorate?: string }).governorate || "Cairo";
    const label = `${line.lineNumber ?? line.id} (${line.fromArea} → ${line.toArea})`;
    try {
      const result = await buildBusRoutePathAI(
        line.fromArea,
        line.toArea,
        line.viaStops || [],
        gov,
      );
      const coords = result.routePath?.coordinates.length ?? 0;
      const stepReason = validateSnappedPath(line.routePath?.coordinates, result.routePath?.coordinates);
      // Two independent checks, both must pass: per-step jump size / endpoint
      // drift (stepReason) catches a single bad snap, while result.flagged
      // catches a path whose individual steps all look fine but whose total
      // length is still a multiple of the straight-line distance — the
      // signature of a route that loops or zigzags overall.
      const reason = stepReason ?? (result.flagged ? result.flagReason ?? "loops_or_zigzags" : null);
      if (result.routePath && !reason) {
        await db
          .update(transitLinesTable)
          .set({
            routePath: result.routePath,
            dataSource: line.dataSource === "discovery" ? line.dataSource : "admin",
            sourcePriority: line.dataSource === "discovery" ? line.sourcePriority : 20,
            confidenceScore: result.usedAI ? 0.78 : 0.7,
            routeStatus: "active",
            needsReviewReason: null,
            verifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(transitLinesTable.id, line.id));
        updated++;
        results.push({ id: line.id, line: line.lineNumber, status: "updated", coords, droppedBacktrackCount: result.droppedBacktrackCount });
        console.log(`[re-enrich] ✓ ${label} — ${coords} pts (AI=${result.usedAI})`);
      } else {
        await db
          .update(transitLinesTable)
          .set({
            routeStatus: "needs_review",
            needsReviewReason: reason ?? "uncertain_resnap",
            updatedAt: new Date(),
          })
          .where(eq(transitLinesTable.id, line.id));
        skipped++;
        results.push({ id: line.id, line: line.lineNumber, status: reason ?? "skipped", coords, droppedBacktrackCount: result.droppedBacktrackCount });
        console.log(`[re-enrich] ↷ ${label} — marked needs_review (${reason ?? "new=" + coords + " pts"})`);
      }
    } catch (err) {
      await db
        .update(transitLinesTable)
        .set({
          routeStatus: "needs_review",
          needsReviewReason: "resnap_failed",
          updatedAt: new Date(),
        })
        .where(eq(transitLinesTable.id, line.id));
      failed++;
      results.push({ id: line.id, line: line.lineNumber, status: "failed" });
      console.log(`[re-enrich] ✗ ${label} — ${err instanceof Error ? err.message : err}`);
    }
  }

  // Fresh geometry for the next trip plan.
  if (updated > 0) invalidateGraph();

  const nextOffset = offset + batch.length;
  res.json({
    transportMode: transportMode || "all-board-anywhere",
    dataSourceFilter: dataSourceFilter ? [...dataSourceFilter] : "all-except-discovery",
    totalMatching,
    offset,
    limit,
    processed: batch.length,
    updated,
    skipped,
    failed,
    nextOffset,
    done: nextOffset >= totalMatching,
    typeOf: batch.map((l) => typeName.get(l.transportTypeId) ?? "?")[0] ?? null,
    results,
  });
});

export default router;
