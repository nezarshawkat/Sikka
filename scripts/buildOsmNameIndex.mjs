import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import readline from "node:readline";

const input = process.argv[2] || "C:/sikka-valhalla/routing-valhalla/egypt-names.geojsonseq";
const output = process.argv[3] || "C:/sikka-valhalla/routing-valhalla/egypt-name-index.json";

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function geometryPoints(geometry) {
  if (!geometry?.coordinates) return [];
  const type = geometry.type;
  const coordinates = geometry.coordinates;
  if (type === "Point") return [coordinates];
  const line = type === "LineString" ? coordinates : type === "Polygon" ? coordinates[0] : null;
  if (line?.length) {
    const indexes = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round((line.length - 1) * ratio));
    return [...new Set(indexes)].map((index) => line[index]).filter((point) => Array.isArray(point) && point.length >= 2);
  }
  const found = [];
  const visit = (value) => {
    if (found.length >= 12) return;
    if (Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      found.push(value);
      return;
    }
    if (Array.isArray(value)) for (const child of value) visit(child);
  };
  visit(coordinates);
  return found;
}

const index = new Map();
const stream = readline.createInterface({ input: createReadStream(input, { encoding: "utf8" }), crlfDelay: Infinity });
let features = 0;
for await (let line of stream) {
  line = line.replace(/^\x1e/, "").trim();
  if (!line) continue;
  let feature;
  try { feature = JSON.parse(line); } catch { continue; }
  const properties = feature.properties || {};
  const aliases = [properties.name, properties["name:ar"], properties["name:en"], properties.alt_name]
    .flatMap((value) => String(value || "").split(";"))
    .map(normalize)
    .filter(Boolean);
  if (!aliases.length) continue;
  const points = geometryPoints(feature.geometry).filter((point) =>
    point[0] >= 24.5 && point[0] <= 37.8 && point[1] >= 21.3 && point[1] <= 32.2,
  );
  if (!points.length) continue;
  for (const alias of new Set(aliases)) {
    const stored = index.get(alias) || [];
    for (const point of points) {
      if (stored.length >= 300) break;
      if (!stored.some((existing) => Math.abs(existing[0] - point[0]) < 0.0001 && Math.abs(existing[1] - point[1]) < 0.0001)) {
        stored.push([Number(point[0]), Number(point[1])]);
      }
    }
    index.set(alias, stored);
  }
  features += 1;
  if (features % 100000 === 0) console.log(`Indexed ${features} named features...`);
}

const sorted = Object.fromEntries([...index.entries()].sort(([a], [b]) => a.localeCompare(b)));
await writeFile(output, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), names: sorted }), "utf8");
console.log(`Wrote ${index.size} normalized names from ${features} features to ${output}`);
