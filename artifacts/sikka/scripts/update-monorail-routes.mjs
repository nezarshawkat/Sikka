import { readFile, writeFile } from "node:fs/promises";

const snapshotPath = "public/offline-snapshot.json";

function parseJson(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

function haversineKm(a, b) {
  const r = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function densify(points, maxKm = 0.09) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const from = out[out.length - 1];
    const to = points[i];
    const steps = Math.max(1, Math.ceil(haversineKm(from, to) / maxKm));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      out.push([
        Number((from[0] + (to[0] - from[0]) * t).toFixed(5)),
        Number((from[1] + (to[1] - from[1]) * t).toFixed(5)),
      ]);
    }
  }
  return out;
}

function lineKm(path) {
  let km = 0;
  for (let i = 1; i < path.length; i++) km += haversineKm(path[i - 1], path[i]);
  return km;
}

function fareForKm(km) {
  if (km <= 9) return 20;
  if (km <= 16) return 30;
  if (km <= 23) return 40;
  if (km <= 30) return 50;
  if (km <= 38) return 60;
  if (km <= 48) return 70;
  return 80;
}

const eastStations = [
  ["Stadium", [31.3123, 30.0691]],
  ["Hisham Barakat", [31.3297, 30.0730]],
  ["Al-Azhar University", [31.3455, 30.0755]],
  ["Seventh District", [31.3626, 30.0715]],
  ["El-Musheer Ahmed Ismail", [31.3869, 30.0550]],
  ["Jehan El-Sadat", [31.4105, 30.0467]],
  ["El-Musheer Tantawi", [31.4380, 30.0306]],
  ["One Ninety", [31.4705, 30.0131]],
  ["Air Force Hospital", [31.4972, 30.0030]],
  ["El-Nargues", [31.5252, 29.9910]],
  ["Investors", [31.5540, 29.9740]],
  ["Al-Lotus", [31.5922, 29.9541]],
  ["Golden Square", [31.6288, 29.9408]],
  ["Beit El-Watan", [31.6662, 29.9237]],
  ["Al-Fattah Al-Alim Mosque", [31.7068, 29.9329]],
  ["R1", [31.7397, 29.9460]],
  ["R2", [31.7725, 29.9591]],
  ["Central Business District", [31.8053, 29.9722]],
  ["Art and Culture City", [31.8325, 29.9898]],
  ["Governmental District", [31.8581, 30.0042]],
  ["Misr Mosque", [31.8876, 30.0159]],
  ["Justice City", [31.9168, 30.0302]],
];

const westStations = [
  ["New October", [30.8240, 29.9330]],
  ["Industrial Zone", [30.8840, 29.9480]],
  ["Sadat", [30.9440, 29.9640]],
  ["6th October City Authority", [30.9998, 29.9778]],
  ["Engineers Association", [31.0430, 29.9920]],
  ["Nile University", [31.0812, 30.0124]],
  ["Hyper One", [31.0608, 30.0332]],
  ["Cairo-Alexandria Desert Road", [31.1010, 30.0400]],
  ["Mansouriya", [31.1380, 30.0450]],
  ["Mariouteya", [31.1760, 30.0495]],
  ["Ring Road", [31.2050, 30.0548]],
  ["Bashteel", [31.1901, 30.0817]],
  ["Wadi El Nile", [31.2105, 30.0621]],
];

const snapshot = await readFile(snapshotPath, "utf8").then(parseJson);
const types = new Map(snapshot.types.map((type) => [type.id, type]));
for (const type of snapshot.types) {
  if (/monorail/i.test(type.nameEn)) {
    type.averageSpeedKmh = 60;
    type.basePriceEgp = 20;
    type.pricePerKmEgp = 0;
  }
}

function stationPath(stations) {
  return densify(stations.map(([, coord]) => coord));
}

function updateLine(line, stations, fromIndex, toIndex, namePrefix) {
  const segmentStations = stations.slice(fromIndex, toIndex + 1);
  const path = stationPath(segmentStations);
  const km = lineKm(path);
  line.nameEn = `${namePrefix}: ${segmentStations[0][0]} - ${segmentStations[segmentStations.length - 1][0]}`;
  line.nameAr = line.nameEn;
  line.fromArea = segmentStations[0][0];
  line.toArea = segmentStations[segmentStations.length - 1][0];
  line.viaStops = segmentStations.slice(1, -1).map(([name]) => name);
  line.governorate = "Greater Cairo";
  line.cityZone = "greater-cairo";
  line.path = path;
  line.pathPointCount = path.length;
  line.snapshotPointCount = path.length;
  line.maxStepMeters = Math.round(Math.max(...path.slice(1).map((point, idx) => haversineKm(path[idx], point) * 1000)));
  line.pathSuspect = false;
  line.routeQuality = "gtfs";
  line.priceEgp = fareForKm(km);
  line.frequencyMinutes = 8;
  line.hasFixedStops = true;
  line.source = "cairo-monorail-stations-ai-assisted";
}

let updated = 0;
for (const line of snapshot.lines) {
  const type = types.get(line.transportTypeId);
  if (!/monorail/i.test(type?.nameEn ?? "")) continue;
  const number = String(line.lineNumber ?? "");
  if (number === "MR-E") updateLine(line, eastStations, 0, eastStations.length - 1, "Cairo Monorail East Nile");
  else if (number.startsWith("MR-E-")) {
    const idx = Math.max(1, Number(number.split("-").at(-1)) || 1);
    updateLine(line, eastStations, Math.min(idx - 1, eastStations.length - 2), Math.min(idx, eastStations.length - 1), "Cairo Monorail East Nile");
  } else if (number === "MR-W") updateLine(line, westStations, 0, westStations.length - 1, "Cairo Monorail West Nile");
  else if (number.startsWith("MR-W-")) {
    const idx = Math.max(1, Number(number.split("-").at(-1)) || 1);
    updateLine(line, westStations, Math.min(idx - 1, westStations.length - 2), Math.min(idx, westStations.length - 1), "Cairo Monorail West Nile");
  } else continue;
  updated++;
}

snapshot.generatedAt = new Date().toISOString();
snapshot.revision = `${snapshot.schemaVersion}-monorail-${Date.now()}-${snapshot.types.length}-${snapshot.lines.length}`;
await writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");
console.log(JSON.stringify({ updated, revision: snapshot.revision }, null, 2));
