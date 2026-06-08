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

const router = Router();

router.post("/", requireAdmin, async (req, res) => {
  const transportMode =
    typeof req.query.transportMode === "string" ? req.query.transportMode.trim() : "";
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT),
  );
  const offset = Math.max(0, Number(req.query.offset) || 0);

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

  const totalMatching = targets.length;
  const batch = targets.slice(offset, offset + limit);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const results: Array<{ id: string; line: string | null; status: string; coords?: number }> = [];

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
      if (result.routePath && coords >= MIN_COORDS) {
        await db
          .update(transitLinesTable)
          .set({ routePath: result.routePath })
          .where(eq(transitLinesTable.id, line.id));
        updated++;
        results.push({ id: line.id, line: line.lineNumber, status: "updated", coords });
        console.log(`[re-enrich] ✓ ${label} — ${coords} pts (AI=${result.usedAI})`);
      } else {
        skipped++;
        results.push({ id: line.id, line: line.lineNumber, status: "skipped", coords });
        console.log(`[re-enrich] ↷ ${label} — kept old path (new=${coords} pts)`);
      }
    } catch (err) {
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
