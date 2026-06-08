/**
 * CLI runner for the stop dictionary import (ops / one-off population).
 * Usage: pnpm --filter @workspace/api-server run seed:stops
 * (after a build it lives at dist/scripts/importStops.mjs)
 */
import { pool } from "@workspace/db";
import { runStopImport } from "../utils/importStopsDictionary.js";

async function main(): Promise<void> {
  const summary = await runStopImport();
  // eslint-disable-next-line no-console
  console.log("Stop dictionary import complete:", JSON.stringify(summary, null, 2));
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error("Stop dictionary import failed:", err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
