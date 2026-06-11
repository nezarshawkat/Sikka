import { readFile, writeFile } from "node:fs/promises";

const inputPath = process.argv[2] || "C:/Users/nezar/OneDrive/Desktop/sikka-transit-data.json";
const outputPath = "public/offline-snapshot.json";

function parseJson(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

function repairText(value) {
  if (typeof value !== "string") return value;
  if (!/[ØÙÛ]/.test(value)) return value;
  try {
    const repaired = Buffer.from(value, "latin1").toString("utf8");
    return repaired.includes("\uFFFD") ? value : repaired;
  } catch {
    return value;
  }
}

function repairTextArray(value) {
  return Array.isArray(value) ? value.map((item) => repairText(item)) : [];
}

function maxStepMeters(path) {
  let max = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const r = 6371000;
    const dLat = ((b[1] - a[1]) * Math.PI) / 180;
    const dLng = ((b[0] - a[0]) * Math.PI) / 180;
    const lat1 = (a[1] * Math.PI) / 180;
    const lat2 = (b[1] * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    max = Math.max(max, r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
  }
  return Math.round(max);
}

const exportData = await readFile(inputPath, "utf8").then(parseJson);
const types = (exportData.transportTypes ?? []).map((type) => ({
  id: type.id,
  nameEn: type.nameEn ?? "",
  nameAr: repairText(type.nameAr ?? ""),
  icon: type.icon ?? "bus",
  color: type.color ?? "#3B82F6",
  category: type.category ?? "economic",
  governmentType: type.governmentType ?? "private",
  averageSpeedKmh: Number(type.averageSpeedKmh ?? 25),
  basePriceEgp: Number(type.basePriceEgp ?? 5),
  pricePerKmEgp: Number(type.pricePerKmEgp ?? 0),
}));

const lines = (exportData.transitLines ?? [])
  .map((line) => {
    const path = line.routePath?.coordinates ?? [];
    const step = maxStepMeters(path);
    return {
      id: line.id,
      transportTypeId: line.transportTypeId,
      lineNumber: line.lineNumber ?? null,
      nameEn: line.nameEn ?? "",
      nameAr: repairText(line.nameAr ?? ""),
      fromArea: repairText(line.fromArea ?? ""),
      toArea: repairText(line.toArea ?? ""),
      governorate: repairText(line.governorate ?? "Cairo"),
      viaStops: repairTextArray(line.viaStops),
      stops: Array.isArray(line.stops) ? line.stops : null,
      path,
      pathPointCount: path.length,
      snapshotPointCount: path.length,
      maxStepMeters: step,
      pathSuspect: step > 500,
      routeQuality: step > 500 ? "suspect" : path.length >= 50 ? "recorded" : "standard",
      priceEgp: Number(line.priceEgp ?? 5),
      frequencyMinutes: line.frequencyMinutes ?? null,
      hasFixedStops: Boolean(line.hasFixedStops),
    };
  })
  .filter((line) => line.id && line.transportTypeId && line.path.length >= 2);

const snapshot = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  revision: `3-uploaded-${Date.now()}-${types.length}-${lines.length}`,
  source: exportData.source ?? "uploaded sikka-transit-data.json",
  types,
  lines,
};

await writeFile(outputPath, JSON.stringify(snapshot), "utf8");
console.log(JSON.stringify({ types: types.length, lines: lines.length, revision: snapshot.revision }, null, 2));
