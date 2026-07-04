#!/usr/bin/env node
/**
 * Generates src/data/bundledSnapshot.json from your LIVE deployed backend,
 * so the next APK build ships with real, current route data baked in —
 * zero network calls needed for trip planning to work from the moment the
 * app is first opened.
 *
 * Run this ONCE before every release build, after you've finished seeding
 * (CSV re-enrichment, LRT/BRT/Tram, etc.) and you're happy with the data:
 *
 *   node scripts/exportBundledSnapshot.mjs https://your-api-domain.com
 *
 * (defaults to the VITE_API_URL in your .env if no argument is given)
 *
 * This does NOT touch your database — it only reads the existing public
 * /api/offline/snapshot endpoint and writes the result to a file that gets
 * bundled into the app at build time. The app's existing manifest/delta
 * sync mechanism still checks for anything an admin changes AFTER this
 * export was generated, but only as a small, infrequent check — never a
 * full re-fetch per trip or per install.
 */
import { writeFileSync, readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "../src/data/bundledSnapshot.json");

function readEnvApiUrl() {
  const envPath = path.join(__dirname, "../.env");
  if (!existsSync(envPath)) return null;
  const match = readFileSync(envPath, "utf-8").match(/^VITE_API_URL\s*=\s*(.+)$/m);
  return match ? match[1].trim().replace(/\/+$/, "") : null;
}

const apiOrigin = process.argv[2] || readEnvApiUrl();
if (!apiOrigin) {
  console.error("Usage: node scripts/exportBundledSnapshot.mjs <api-origin>");
  console.error("  e.g.: node scripts/exportBundledSnapshot.mjs https://sikka-mq6w.onrender.com");
  process.exit(1);
}

const url = `${apiOrigin.replace(/\/+$/, "")}/api/offline/snapshot`;
console.log(`Fetching ${url} ...`);

const res = await fetch(url);
if (!res.ok) {
  console.error(`Failed: HTTP ${res.status} ${res.statusText}`);
  process.exit(1);
}
const snapshot = await res.json();

if (!Array.isArray(snapshot.lines) || !Array.isArray(snapshot.types)) {
  console.error("Response didn't look like a valid snapshot (missing types/lines arrays). Aborting — not overwriting the existing bundle.");
  process.exit(1);
}

writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
console.log(`Wrote ${snapshot.types.length} transport types and ${snapshot.lines.length} lines to ${outPath}`);
console.log(`Revision: ${snapshot.revision}`);
console.log("\nNext step: rebuild the app (this file is bundled at build time) before publishing the next release.");
