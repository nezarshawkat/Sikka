import { readFile, writeFile } from "node:fs/promises";

const snapshotPath = "public/offline-snapshot.json";
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || "pk.eyJ1IjoibmV6YXJpc21haWwiLCJhIjoiY21ucTdoZ3gxMDRiNzJxcjRhemY0ejhhbyJ9.fkkcuisxpZP9y0Uaq9HryQ";
const ROAD_MODES = ["bus", "serfis", "microbus"];
const ANCHOR_GAP_KM = 1.4;
const MAX_TOTAL_ANCHORS = 90;
const MAX_CHUNK_ANCHORS = 24;

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

function haversineKm(a, b) {
  const r = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function pathLengthKm(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineKm(path[i - 1], path[i]);
  return total;
}

function appendCoords(target, coords) {
  for (let i = 0; i < coords.length; i++) {
    const point = coords[i];
    const prev = target[target.length - 1];
    if (prev && haversineKm(prev, point) < 0.01) continue;
    target.push([Number(point[0].toFixed(5)), Number(point[1].toFixed(5))]);
  }
}

function anchorsFor(path) {
  if (path.length <= 2) return path;
  const anchors = [path[0]];
  let sinceLast = 0;
  for (let i = 1; i < path.length - 1; i++) {
    sinceLast += haversineKm(path[i - 1], path[i]);
    if (sinceLast >= ANCHOR_GAP_KM) {
      anchors.push(path[i]);
      sinceLast = 0;
    }
  }
  anchors.push(path[path.length - 1]);
  if (anchors.length <= MAX_TOTAL_ANCHORS) return anchors;
  const out = [];
  const step = (anchors.length - 1) / (MAX_TOTAL_ANCHORS - 1);
  for (let i = 0; i < MAX_TOTAL_ANCHORS; i++) out.push(anchors[Math.round(i * step)]);
  return out;
}

async function fetchMapboxDirections(coords) {
  const encoded = coords.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${encoded}?geometries=geojson&overview=full&continue_straight=false&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const route = data.routes?.[0]?.geometry?.coordinates;
  return Array.isArray(route) && route.length >= 2 ? route : null;
}

async function fetchOsrmDirections(coords) {
  const encoded = coords.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${encoded}?overview=full&geometries=geojson&continue_straight=false&alternatives=false&steps=false`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const route = data.routes?.[0]?.geometry?.coordinates;
  return Array.isArray(route) && route.length >= 2 ? route : null;
}

async function onlineRoute(path) {
  const anchors = anchorsFor(path);
  const out = [];
  for (let start = 0; start < anchors.length - 1; start += MAX_CHUNK_ANCHORS - 1) {
    const chunk = anchors.slice(start, Math.min(anchors.length, start + MAX_CHUNK_ANCHORS));
    let route = await fetchMapboxDirections(chunk);
    if (!route) route = await fetchOsrmDirections(chunk);
    if (!route) return null;
    appendCoords(out, route);
  }
  const rawLen = Math.max(0.1, pathLengthKm(path));
  const routedLen = pathLengthKm(out);
  if (out.length < 2 || routedLen > rawLen * 3.2 + 12) return null;
  return out;
}

const snapshot = await readFile(snapshotPath, "utf8").then(parseJson);
const types = new Map(snapshot.types.map((type) => [type.id, type]));
let fixed = 0;
let failed = 0;
let skipped = 0;

for (const line of snapshot.lines) {
  const type = types.get(line.transportTypeId);
  const mode = modeOfType(type?.nameEn);
  if (!ROAD_MODES.includes(mode) || !line.pathSuspect) {
    skipped++;
    continue;
  }
  const routed = await onlineRoute(line.path);
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
  console.log(`Online matched ${fixed}: ${line.lineNumber || line.nameEn}`);
}

snapshot.schemaVersion = Math.max(snapshot.schemaVersion ?? 2, 3);
snapshot.generatedAt = new Date().toISOString();
snapshot.revision = `${snapshot.schemaVersion}-matched-online-${Date.now()}-${snapshot.types.length}-${snapshot.lines.length}`;
await writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");
console.log(JSON.stringify({ fixed, failed, skipped, revision: snapshot.revision }, null, 2));
