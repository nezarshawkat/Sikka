import { createHash } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";

const PREPARED_PATH = path.resolve("scripts/generated/prepared-device-route-seed.json");
const MANIFEST_PATH = path.resolve("scripts/generated/prepared-device-route-seed-manifest.json");
const TARGET_PATH = path.resolve("artifacts/sikka/src/data/bundledSnapshot.json");

async function main() {
  if (!process.argv.includes("--confirm-seed")) {
    throw new Error("Not seeded. Re-run with --confirm-seed only after the user explicitly says to seed it.");
  }
  const [prepared, manifestRaw] = await Promise.all([
    readFile(PREPARED_PATH),
    readFile(MANIFEST_PATH, "utf8"),
  ]);
  const manifest = JSON.parse(manifestRaw) as { ready?: boolean; sha256?: string; routeCount?: number };
  const actualHash = createHash("sha256").update(prepared).digest("hex");
  if (!manifest.ready || !manifest.sha256 || actualHash !== manifest.sha256) {
    throw new Error("Prepared seed or manifest changed; run prepareDeviceRouteSeed again before seeding");
  }
  const payload = JSON.parse(prepared.toString("utf8")) as { lines?: unknown[] };
  if (!Array.isArray(payload.lines) || payload.lines.length !== manifest.routeCount) {
    throw new Error("Prepared seed route count does not match its manifest");
  }
  await copyFile(PREPARED_PATH, TARGET_PATH);
  console.log(`Seeded ${payload.lines.length} routes into ${TARGET_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
