import { readFile, writeFile } from "node:fs/promises";

const snapshotPath = "public/offline-snapshot.json";
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || "pk.eyJ1IjoibmV6YXJpc21haWwiLCJhIjoiY21ucTdoZ3gxMDRiNzJxcjRhemY0ejhhbyJ9.fkkcuisxpZP9y0Uaq9HryQ";

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

function anchorsFor(path, count) {
  if (path.length <= count) return path;
  const out = [];
  const step = (path.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) out.push(path[Math.round(i * step)]);
  return out;
}

function appendCoords(out, coords) {
  for (const point of coords) {
    const rounded = [Number(point[0].toFixed(5)), Number(point[1].toFixed(5))];
    const prev = out[out.length - 1];
    if (!prev || haversineKm(prev, rounded) > 0.01) out.push(rounded);
  }
}

async function route(coords) {
  const encoded = coords.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const urls = [
    `https://api.mapbox.com/directions/v5/mapbox/driving/${encoded}?geometries=geojson&overview=full&continue_straight=false&access_token=${MAPBOX_TOKEN}`,
    `https://router.project-osrm.org/route/v1/driving/${encoded}?overview=full&geometries=geojson&continue_straight=false&alternatives=false&steps=false`,
  ];
  for (const url of urls) {
    const res = await fetch(url);
    if (!res.ok) continue;
    const data = await res.json();
    const coords = data.routes?.[0]?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) return coords;
  }
  return null;
}

async function routePath(path) {
  for (const anchorCount of [18, 12, 8, 2]) {
    const anchors = anchorsFor(path, anchorCount);
    const out = [];
    let ok = true;
    for (let start = 0; start < anchors.length - 1; start += 23) {
      const chunk = anchors.slice(start, Math.min(anchors.length, start + 24));
      const routed = await route(chunk);
      if (!routed) {
        ok = false;
        break;
      }
      appendCoords(out, routed);
    }
    if (ok && out.length >= 2) return out;
  }
  return null;
}

const snapshot = await readFile(snapshotPath, "utf8").then(parseJson);
let fixed = 0;
let failed = 0;
for (const line of snapshot.lines) {
  if (!line.pathSuspect) continue;
  const routed = await routePath(line.path);
  if (!routed) {
    failed++;
    console.warn(`Still failed: ${line.lineNumber || line.nameEn}`);
    continue;
  }
  line.path = routed;
  line.snapshotPointCount = routed.length;
  line.pathPointCount = Math.max(line.pathPointCount ?? 0, routed.length);
  line.maxStepMeters = Math.round(Math.max(...routed.slice(1).map((point, idx) => haversineKm(routed[idx], point) * 1000)));
  line.pathSuspect = false;
  line.routeQuality = "standard";
  fixed++;
  console.log(`Force matched: ${line.lineNumber || line.nameEn}`);
}
snapshot.generatedAt = new Date().toISOString();
snapshot.revision = `${snapshot.schemaVersion}-matched-final-${Date.now()}-${snapshot.types.length}-${snapshot.lines.length}`;
await writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");
console.log(JSON.stringify({ fixed, failed, revision: snapshot.revision }, null, 2));
