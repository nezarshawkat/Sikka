/**
 * Narrow, metadata-only repair for the `has_fixed_stops` flag.
 *
 * What this is for: the pathfinder decides how riders can board a line from
 * exactly one boolean (`transit_lines.has_fixed_stops`, see engine/graph.ts).
 * When it's true, riders can only board at the line's real named stops. When
 * it's false, the graph also generates synthetic "board anywhere" points
 * every ~1km along the path — correct for buses/microbuses/serfis, wrong for
 * gated-station rail like Metro/Monorail/Train, which should only ever use
 * their real stations.
 *
 * If some Monorail rows were seeded (or hand-edited) before that distinction
 * was enforced, they can end up stuck with has_fixed_stops = false, which is
 * what produces "the route doesn't start from the station, it boards
 * anywhere" — the rider gets routed to a synthetic point near a station
 * instead of the station itself.
 *
 * This endpoint ONLY ever updates that one boolean column. It never touches
 * route_path, stops, viaStops, names, coordinates, ordering, or anything
 * else about the line — running it can change *where a rider is allowed to
 * board*, never *the route itself*.
 *
 * GET  /api/admin/fixed-stops-repair?transportType=Monorail
 *   Dry run (default) — reports which lines would change, changes nothing.
 * POST /api/admin/fixed-stops-repair?transportType=Monorail
 *   Applies the fix.
 */
import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, transitLinesTable, transportTypesTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

// Rail-like modes that should always use real stations only. Monorail is the
// one this was reported for; Metro/Train/LRT are included only as a safety
// net in case the same stale-data issue ever shows up there — nothing here
// runs automatically, it's still one explicit admin request per transport type.
const RAIL_LIKE_TYPE_NAMES = new Set(["Monorail", "Metro", "Train", "LRT"]);

async function findAffectedLines(transportTypeName: string) {
  const [type] = await db
    .select({ id: transportTypesTable.id, nameEn: transportTypesTable.nameEn })
    .from(transportTypesTable)
    .where(eq(transportTypesTable.nameEn, transportTypeName))
    .limit(1);

  if (!type) return { type: null, lines: [] as { id: string; nameEn: string; lineNumber: string | null }[] };

  const lines = await db
    .select({
      id: transitLinesTable.id,
      nameEn: transitLinesTable.nameEn,
      lineNumber: transitLinesTable.lineNumber,
    })
    .from(transitLinesTable)
    .where(and(eq(transitLinesTable.transportTypeId, type.id), eq(transitLinesTable.hasFixedStops, false)));

  return { type, lines };
}

router.get("/", requireAdmin, async (req, res) => {
  const transportTypeName = typeof req.query.transportType === "string" ? req.query.transportType : "Monorail";
  if (!RAIL_LIKE_TYPE_NAMES.has(transportTypeName)) {
    return res.status(400).json({
      error: `transportType must be one of: ${[...RAIL_LIKE_TYPE_NAMES].join(", ")}`,
    });
  }
  const { type, lines } = await findAffectedLines(transportTypeName);
  if (!type) return res.status(404).json({ error: `Transport type "${transportTypeName}" not found` });

  res.json({
    dryRun: true,
    transportType: transportTypeName,
    wouldUpdate: lines.length,
    lines: lines.map((l) => ({ id: l.id, name: l.nameEn, lineNumber: l.lineNumber })),
    note: "No changes made. POST to this same URL to apply. Only has_fixed_stops is ever touched — route paths, stops, and names are never modified by this endpoint.",
  });
  return;
});

router.post("/", requireAdmin, async (req, res) => {
  const transportTypeName = typeof req.query.transportType === "string" ? req.query.transportType : "Monorail";
  if (!RAIL_LIKE_TYPE_NAMES.has(transportTypeName)) {
    return res.status(400).json({
      error: `transportType must be one of: ${[...RAIL_LIKE_TYPE_NAMES].join(", ")}`,
    });
  }
  const { type, lines } = await findAffectedLines(transportTypeName);
  if (!type) return res.status(404).json({ error: `Transport type "${transportTypeName}" not found` });

  if (lines.length > 0) {
    await db
      .update(transitLinesTable)
      .set({ hasFixedStops: true, updatedAt: new Date() })
      .where(and(eq(transitLinesTable.transportTypeId, type.id), eq(transitLinesTable.hasFixedStops, false)));
  }

  res.json({
    dryRun: false,
    transportType: transportTypeName,
    updated: lines.length,
    lines: lines.map((l) => ({ id: l.id, name: l.nameEn, lineNumber: l.lineNumber })),
    note: "has_fixed_stops set to true for the lines above. Nothing else about these lines was changed. The in-memory route graph rebuilds on its own cache TTL (5 min) or on next deploy — no restart required, but you can wait up to 5 minutes to see it take effect.",
  });
  return;
});

export default router;
