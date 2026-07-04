import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@workspace/db";
import { buildOfflinePayload } from "../routes/offlineSnapshot";

async function main() {
  const explicit = process.argv.find((value) => value.startsWith("--output="))?.slice(9);
  const output = path.resolve(explicit || "artifacts/sikka/src/data/bundledSnapshot.json");
  const payload = await buildOfflinePayload();
  if (!payload.lines.length || !payload.types.length) throw new Error("Refusing to write an empty bundled snapshot");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(payload, null, 2));
  console.log(`Bundled ${payload.lines.length} permanent routes and ${payload.types.length} transport types.`);
  console.log(`Revision: ${payload.revision}`);
  console.log(`Output: ${output}`);
}

main().finally(async () => pool.end()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
