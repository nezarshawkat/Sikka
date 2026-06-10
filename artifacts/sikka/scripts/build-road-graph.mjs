import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const OUT = resolve("public/offline-road-graph.json");
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
];

const REGIONS = [
  { id: "cairo-giza", name: "Cairo / Giza", bbox: [29.72, 30.78, 30.38, 31.85] },
  { id: "alexandria", name: "Alexandria", bbox: [30.98, 29.42, 31.42, 30.18] },
];

const DRIVE_HIGHWAYS = new Set([
  "motorway", "trunk", "primary", "secondary", "tertiary",
  "unclassified", "residential", "service", "motorway_link", "trunk_link",
  "primary_link", "secondary_link", "tertiary_link", "living_street",
]);

const WALK_HIGHWAYS = new Set([
  ...DRIVE_HIGHWAYS,
  "pedestrian", "footway", "path", "steps", "track", "cycleway",
]);

function tileRegion(region, rows = 3, cols = 4) {
  const [south, west, north, east] = region.bbox;
  const tiles = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const s = south + ((north - south) * row) / rows;
      const n = south + ((north - south) * (row + 1)) / rows;
      const w = west + ((east - west) * col) / cols;
      const e = west + ((east - west) * (col + 1)) / cols;
      tiles.push({ ...region, id: `${region.id}-${row}-${col}`, bbox: [s, w, n, e] });
    }
  }
  return tiles;
}

function queryFor([south, west, north, east]) {
  return `
[out:json][timeout:180];
(
  way["highway"]["highway"!~"construction|proposed|raceway|bus_guideway"](${south},${west},${north},${east});
);
out body;
>;
out skel qt;`;
}

async function fetchTile(tile, attempt = 1) {
  const body = queryFor(tile.bbox);
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "user-agent": "Sikka offline road graph builder (contact: github.com/nezarshawkat/Sikka)",
        },
        body,
      });
      if (res.ok) {
        const data = await res.json();
        return data.elements ?? [];
      }
      const text = await res.text().catch(() => "");
      console.warn(`${tile.id} failed on ${url}: ${res.status} ${res.statusText} ${text.slice(0, 180).replace(/\s+/g, " ")}`);
    } catch (err) {
      console.warn(`${tile.id} failed on ${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (attempt < 3) {
    await new Promise((r) => setTimeout(r, 5000 * attempt));
    return fetchTile(tile, attempt + 1);
  }
  throw new Error(`${tile.id} failed on all Overpass endpoints`);
}

function haversineMeters(a, b) {
  const r = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function roadFlags(tags = {}) {
  const highway = tags.highway;
  const access = `${tags.access ?? ""}`.toLowerCase();
  const motorVehicle = `${tags.motor_vehicle ?? tags.vehicle ?? ""}`.toLowerCase();
  const foot = `${tags.foot ?? ""}`.toLowerCase();
  const service = `${tags.service ?? ""}`.toLowerCase();
  const driveDenied = ["no", "private", "customers", "permit"].includes(access) || ["no", "private"].includes(motorVehicle);
  const walkDenied = ["no", "private"].includes(access) || foot === "no";
  const drive = DRIVE_HIGHWAYS.has(highway) && !driveDenied && service !== "driveway";
  const walk = WALK_HIGHWAYS.has(highway) && !walkDenied;
  const oneWay = tags.oneway === "yes" || tags.oneway === "1" || tags.junction === "roundabout";
  const reverseOneWay = tags.oneway === "-1";
  return { drive, walk, oneWay, reverseOneWay };
}

function speedKmh(tags = {}) {
  const highway = tags.highway;
  if (tags.maxspeed) {
    const match = String(tags.maxspeed).match(/\d+/);
    if (match) return Math.max(10, Math.min(100, Number(match[0])));
  }
  if (highway === "motorway") return 80;
  if (highway === "trunk" || highway === "primary") return 60;
  if (highway === "secondary" || highway === "tertiary") return 45;
  if (highway === "service" || highway === "living_street") return 15;
  return 30;
}

function addEdge(edgesByKey, from, to, meters, flags, tags) {
  if (meters <= 0 || meters > 3000) return;
  const mode = (flags.drive ? 1 : 0) | (flags.walk ? 2 : 0);
  if (!mode) return;
  const key = `${from}:${to}`;
  const speed = speedKmh(tags);
  const existing = edgesByKey.get(key);
  if (!existing || meters < existing[2]) edgesByKey.set(key, [from, to, Math.round(meters), mode, speed]);
}

async function main() {
  const nodeMap = new Map();
  const ways = new Map();
  const tiles = REGIONS.flatMap((region) => tileRegion(region));

  for (const tile of tiles) {
    console.log(`Fetching ${tile.id}`);
    const elements = await fetchTile(tile);
    for (const el of elements) {
      if (el.type === "node") nodeMap.set(el.id, [Number(el.lon.toFixed(6)), Number(el.lat.toFixed(6))]);
      if (el.type === "way" && Array.isArray(el.nodes)) ways.set(el.id, { nodes: el.nodes, tags: el.tags ?? {} });
    }
  }

  const usedNodes = new Map();
  const nodes = [];
  const nodeIndex = (osmId) => {
    if (usedNodes.has(osmId)) return usedNodes.get(osmId);
    const coord = nodeMap.get(osmId);
    if (!coord) return -1;
    const idx = nodes.length;
    usedNodes.set(osmId, idx);
    nodes.push(coord);
    return idx;
  };

  const edgesByKey = new Map();
  for (const way of ways.values()) {
    const flags = roadFlags(way.tags);
    if (!flags.drive && !flags.walk) continue;
    for (let i = 1; i < way.nodes.length; i++) {
      const a = nodeIndex(way.nodes[i - 1]);
      const b = nodeIndex(way.nodes[i]);
      if (a < 0 || b < 0 || a === b) continue;
      const meters = haversineMeters(nodes[a], nodes[b]);
      if (flags.reverseOneWay) {
        addEdge(edgesByKey, b, a, meters, flags, way.tags);
      } else if (flags.oneWay) {
        addEdge(edgesByKey, a, b, meters, flags, way.tags);
      } else {
        addEdge(edgesByKey, a, b, meters, flags, way.tags);
        addEdge(edgesByKey, b, a, meters, flags, way.tags);
      }
    }
  }

  const graph = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: "OpenStreetMap Overpass API",
    regions: REGIONS,
    nodes,
    edges: [...edgesByKey.values()],
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(graph), "utf8");
  console.log(`Wrote ${OUT}`);
  console.log(`${nodes.length} nodes, ${graph.edges.length} directed edges`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
