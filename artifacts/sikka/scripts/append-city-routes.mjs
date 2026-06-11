import { readFile, writeFile } from "node:fs/promises";

const snapshotPath = "public/offline-snapshot.json";
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || process.env.VITE_MAPBOX_TOKEN || "pk.eyJ1IjoibmV6YXJpc21haWwiLCJhIjoiY21ucTdoZ3gxMDRiNzJxcjRhemY0ejhhbyJ9.fkkcuisxpZP9y0Uaq9HryQ";
const ALEX_BUS_URL = "https://alexapta.gov.eg/%d8%ae%d8%b7%d9%88%d8%b7-%d8%a7%d9%84%d8%a3%d9%88%d8%aa%d9%88%d8%a8%d9%8a%d8%b3/";

function parseJson(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

function decodeHtml(value) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function splitStops(path) {
  return decodeHtml(path)
    .split(/\s*(?:-|–|—|،|,|←|→)\s*/g)
    .map((s) => s.trim())
    .filter((s) => s && !/^[-_]+$/.test(s));
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

function densify(path, maxKm = 0.06) {
  if (path.length < 2) return path;
  const out = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const from = out[out.length - 1];
    const to = path[i];
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

const geocodeCache = new Map();
async function geocodeStop(stop) {
  const key = stop.toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key);
  const query = encodeURIComponent(`${stop}, Alexandria, Egypt`);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_TOKEN}&country=eg&language=ar,en&limit=1&proximity=29.9187,31.2001`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const data = await res.json();
    const center = data.features?.[0]?.center;
    if (!Array.isArray(center)) return null;
    if (center[0] < 29.45 || center[0] > 30.35 || center[1] < 30.95 || center[1] > 31.45) return null;
    geocodeCache.set(key, center);
    return center;
  } catch {
    return null;
  }
}

async function snapDriving(points) {
  if (points.length < 2) return points;
  const out = [];
  for (let i = 0; i < points.length - 1; i += 20) {
    const chunk = points.slice(i, Math.min(points.length, i + 21));
    const encoded = chunk.map(([lng, lat]) => `${lng},${lat}`).join(";");
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${encoded}?geometries=geojson&overview=full&continue_straight=false&access_token=${MAPBOX_TOKEN}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(18000) });
      const data = res.ok ? await res.json() : null;
      const coords = data?.routes?.[0]?.geometry?.coordinates;
      const chosen = Array.isArray(coords) && coords.length >= 2 ? coords : chunk;
      if (!out.length) out.push(...chosen);
      else out.push(...chosen.slice(1));
    } catch {
      if (!out.length) out.push(...chunk);
      else out.push(...chunk.slice(1));
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return densify(out);
}

async function buildPathFromStops(stops) {
  const points = [];
  for (const stop of stops.slice(0, 18)) {
    const point = await geocodeStop(stop);
    if (point) {
      const prev = points[points.length - 1];
      if (!prev || haversineKm(prev, point) > 0.08) points.push(point);
    }
    await new Promise((resolve) => setTimeout(resolve, 45));
  }
  if (points.length < 2) return null;
  return snapDriving(points);
}

async function fetchAlexBusRows() {
  const html = await fetch(ALEX_BUS_URL).then((res) => res.text());
  const table = html.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? "";
  return [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)]
    .slice(1)
    .map((row) => [...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => decodeHtml(cell[1])))
    .filter((cols) => cols.length >= 7 && cols[2] && cols[3] && cols[4]);
}

function ensureType(snapshot, type) {
  const existing = snapshot.types.find((item) => item.id === type.id || item.nameEn === type.nameEn);
  if (existing) return existing.id;
  snapshot.types.push(type);
  return type.id;
}

function alexTramLines(typeId) {
  const raml = [
    [29.9012, 31.2001], [29.9135, 31.2061], [29.9279, 31.2118], [29.9426, 31.2181],
    [29.9519, 31.2268], [29.9585, 31.2362], [29.9668, 31.2442], [29.9786, 31.2525],
    [29.9918, 31.2635], [30.0083, 31.2751], [30.0211, 31.2826],
  ];
  const city = [
    [29.9012, 31.2001], [29.8924, 31.1974], [29.8831, 31.1907], [29.8753, 31.1818],
    [29.8722, 31.1735], [29.8844, 31.1691], [29.8989, 31.1763], [29.9124, 31.1858],
  ];
  return [
    {
      id: "alex-tram-raml-blue",
      transportTypeId: typeId,
      lineNumber: "Raml",
      nameEn: "Alexandria Tram: Raml Station - El Nasr / Mandara corridor",
      nameAr: "ترام الإسكندرية: محطة الرمل - النصر / المندرة",
      fromArea: "محطة الرمل",
      toArea: "المندرة",
      governorate: "Alexandria",
      viaStops: ["الشاطبي", "الإبراهيمية", "سبورتنج", "سيدي جابر", "كليوباترا", "سابا باشا", "جليم", "فيكتوريا"],
      path: densify(raml, 0.03),
      priceEgp: 5,
      frequencyMinutes: 8,
    },
    {
      id: "alex-tram-city",
      transportTypeId: typeId,
      lineNumber: "City",
      nameEn: "Alexandria City Tram",
      nameAr: "ترام المدينة - الإسكندرية",
      fromArea: "محطة الرمل",
      toArea: "رأس التين / كرموز",
      governorate: "Alexandria",
      viaStops: ["المنشية", "بحري", "محرم بك", "كرموز"],
      path: densify(city, 0.03),
      priceEgp: 5,
      frequencyMinutes: 10,
    },
  ].map((line) => ({
    ...line,
    pathPointCount: line.path.length,
    snapshotPointCount: line.path.length,
    maxStepMeters: Math.round(Math.max(...line.path.slice(1).map((point, idx) => haversineKm(line.path[idx], point) * 1000))),
    pathSuspect: false,
    routeQuality: "recorded",
    hasFixedStops: true,
    source: "official-alexapta-tram-map-ai-assisted",
  }));
}

const snapshot = await readFile(snapshotPath, "utf8").then(parseJson);
const busTypeId = ensureType(snapshot, {
  id: "alex-cta-bus",
  nameEn: "CTA Bus",
  nameAr: "أتوبيس هيئة النقل بالإسكندرية",
  icon: "bus",
  color: "#0EA5E9",
  category: "economic",
  governmentType: "government",
  averageSpeedKmh: 24,
  basePriceEgp: 8,
  pricePerKmEgp: 0,
});
const tramTypeId = ensureType(snapshot, {
  id: "alex-tram",
  nameEn: "Tram",
  nameAr: "ترام",
  icon: "tram",
  color: "#16A34A",
  category: "economic",
  governmentType: "government",
  averageSpeedKmh: 18,
  basePriceEgp: 5,
  pricePerKmEgp: 0,
});

const existing = new Set(snapshot.lines.map((line) => line.id));
const rows = await fetchAlexBusRows();
let addedBus = 0;
for (const cols of rows) {
  const [, region, lineNumber, nameAr, pathText, model, kind] = cols;
  const id = `alex-cta-bus-${lineNumber}-${nameAr}`.replace(/\s+/g, "-").slice(0, 120);
  if (existing.has(id)) continue;
  const stops = splitStops(pathText);
  const path = await buildPathFromStops(stops);
  if (!path || path.length < 2) continue;
  snapshot.lines.push({
    id,
    transportTypeId: busTypeId,
    lineNumber,
    nameEn: `Alexandria CTA ${lineNumber}: ${nameAr}`,
    nameAr,
    fromArea: stops[0] ?? nameAr,
    toArea: stops[stops.length - 1] ?? nameAr,
    governorate: "Alexandria",
    cityZone: "alexandria",
    viaStops: stops.slice(1, -1),
    stops: null,
    path,
    pathPointCount: path.length,
    snapshotPointCount: path.length,
    maxStepMeters: Math.round(Math.max(...path.slice(1).map((point, idx) => haversineKm(path[idx], point) * 1000))),
    pathSuspect: false,
    routeQuality: "rough",
    priceEgp: kind.includes("مكيف") ? 10 : 8,
    frequencyMinutes: model.includes("ميني") ? 14 : 18,
    hasFixedStops: false,
    source: "official-alexapta-bus-table-ai-snapped",
    vehicleModel: model,
    serviceKind: kind,
    region,
  });
  existing.add(id);
  addedBus++;
  if (addedBus % 20 === 0) console.log(`Added Alexandria CTA bus routes: ${addedBus}`);
}

let addedTram = 0;
for (const line of alexTramLines(tramTypeId)) {
  if (existing.has(line.id)) continue;
  snapshot.lines.push(line);
  existing.add(line.id);
  addedTram++;
}

snapshot.generatedAt = new Date().toISOString();
snapshot.revision = `${snapshot.schemaVersion}-city-routes-${Date.now()}-${snapshot.types.length}-${snapshot.lines.length}`;
await writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");
console.log(JSON.stringify({ addedBus, addedTram, types: snapshot.types.length, lines: snapshot.lines.length, revision: snapshot.revision }, null, 2));
