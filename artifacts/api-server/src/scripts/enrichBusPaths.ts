/**
 * One-off / re-runnable enrichment of existing bus route geometry.
 *
 * Loads every "board-anywhere" transit line (hasFixedStops = false — i.e.
 * bus / serfis / microbus, NOT metro/monorail/train) and regenerates its
 * route_path using the AI-breadcrumb + driving-traffic pipeline, then writes
 * the corrected polyline back to the DB.
 *
 * Usage (after build):
 *   pnpm --filter @workspace/api-server run enrich:bus-paths
 *   pnpm --filter @workspace/api-server run enrich:bus-paths -- --all     (re-do even lines that already have a path)
 *   pnpm --filter @workspace/api-server run enrich:bus-paths -- --limit=20
 *   pnpm --filter @workspace/api-server run enrich:bus-paths -- --city=Alexandria
 */
import { pool, db } from "@workspace/db";
import { transitLinesTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { buildBusRoutePathAI } from "../utils/busPathEnricher.js";

interface Args { all: boolean; limit: number; offset: number; city: string | null; concurrency: number; }

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (name: string) => {
    const hit = args.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.split("=")[1] : null;
  };
  return {
    all: args.includes("--all"),
    limit: Number(get("limit")) || Infinity,
    offset: Number(get("offset")) || 0,
    city: get("city"),
    // I/O-bound work (AI + Mapbox) — process a few lines in parallel to keep the
    // bulk run to a sensible duration. Shared geocode/breadcrumb caches are safe
    // under Node's single-threaded async model.
    concurrency: Math.min(8, Math.max(1, Number(get("concurrency")) || 4)),
  };
}

async function main(): Promise<void> {
  const { all, limit, offset, city, concurrency } = parseArgs();

  // Stable ordering by id so --offset/--limit batches are deterministic and resumable.
  const lines = await db.select().from(transitLinesTable).orderBy(asc(transitLinesTable.id));
  const gov = (l: typeof lines[number]) => (l as { governorate?: string }).governorate || "Cairo";
  // Only board-anywhere modes need a road-snapped corridor; metro/monorail/train use fixed station pairs.
  let targets = lines.filter(l => !l.hasFixedStops);
  if (!all) targets = targets.filter(l => !l.routePath || !(l.routePath as { coordinates?: unknown[] })?.coordinates?.length);
  if (city) targets = targets.filter(l => gov(l).toLowerCase().includes(city.toLowerCase()));
  if (offset > 0) targets = targets.slice(offset);
  if (Number.isFinite(limit)) targets = targets.slice(0, limit);

  console.log(`Enriching ${targets.length} bus line(s) (all=${all}, city=${city ?? "any"})...`);

  const MIN_COORDS = 10; // never overwrite a good path with a sparse new one
  const total = targets.length;
  console.log(`  (concurrency=${concurrency})`);
  let ok = 0, ai = 0, skipped = 0, failed = 0, done = 0;
  let cursor = 0;

  async function processOne(index: number): Promise<void> {
    const line = targets[index];
    const label = `${line.lineNumber ?? line.id} (${line.fromArea} → ${line.toArea})`;
    try {
      const cityForLine = city || gov(line);
      const result = await buildBusRoutePathAI(
        line.fromArea, line.toArea, line.viaStops || [], cityForLine,
      );
      const coords = result.routePath?.coordinates.length ?? 0;
      if (result.routePath && coords >= MIN_COORDS) {
        await db.update(transitLinesTable)
          .set({ routePath: result.routePath })
          .where(eq(transitLinesTable.id, line.id));
        ok++;
        if (result.usedAI) ai++;
        console.log(`  line ${++done} of ${total}: updated — ${label} — ${coords} pts` +
          ` (${result.geocodedCount} geocoded, AI=${result.usedAI})`);
      } else {
        skipped++;
        console.log(`  line ${++done} of ${total}: skipped — ${label} — kept old path (new=${coords} pts)`);
      }
    } catch (err) {
      failed++;
      console.log(`  line ${++done} of ${total}: failed — ${label} — ${err instanceof Error ? err.message : err}`);
    }
  }

  // Worker pool: each worker pulls the next index off a shared cursor until drained.
  async function worker(): Promise<void> {
    while (cursor < targets.length) {
      const index = cursor++;
      await processOne(index);
      await new Promise(r => setTimeout(r, 150)); // gentle per-worker rate-limit gap
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));

  console.log(`\nDone. updated=${ok}, ai-expanded=${ai}, skipped=${skipped}, failed=${failed}, total=${total}`);
}

main()
  .then(async () => { await pool.end(); process.exit(0); })
  .catch(async (err) => {
    console.error("Bus path enrichment failed:", err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
