import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const snapshotPath = "public/offline-snapshot.json";
const ROAD_MODES = new Set(["bus", "serfis", "microbus"]);

function parseJson(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

function modeOfType(nameEn) {
  const n = String(nameEn || "").toLowerCase();
  if (n.includes("serfis")) return "serfis";
  if (n.includes("microbus")) return "microbus";
  if (n.includes("bus")) return "bus";
  if (n.includes("metro")) return "metro";
  if (n.includes("monorail")) return "monorail";
  if (n.includes("train")) return "train";
  return "bus";
}

const current = await readFile(snapshotPath, "utf8").then(parseJson);
const original = parseJson(execFileSync("git", ["show", "HEAD:artifacts/sikka/public/offline-snapshot.json"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
const currentTypes = new Map(current.types.map((type) => [type.id, type]));
const originalLines = new Map(original.lines.map((line) => [line.id, line]));
let restored = 0;

for (const line of current.lines) {
  const mode = modeOfType(currentTypes.get(line.transportTypeId)?.nameEn);
  if (ROAD_MODES.has(mode)) continue;
  const originalLine = originalLines.get(line.id);
  if (!originalLine) continue;
  line.path = originalLine.path;
  line.pathPointCount = originalLine.pathPointCount;
  line.snapshotPointCount = originalLine.snapshotPointCount;
  line.maxStepMeters = originalLine.maxStepMeters;
  line.pathSuspect = originalLine.pathSuspect;
  line.routeQuality = originalLine.routeQuality;
  restored++;
}

current.generatedAt = new Date().toISOString();
current.revision = `${current.schemaVersion}-roadmatched-${Date.now()}-${current.types.length}-${current.lines.length}`;
await writeFile(snapshotPath, JSON.stringify(current), "utf8");
console.log(JSON.stringify({ restored, revision: current.revision }, null, 2));
