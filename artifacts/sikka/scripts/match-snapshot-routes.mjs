import { readFile, writeFile } from "node:fs/promises";

const snapshotPath = "public/offline-snapshot.json";
const graphPath = "public/offline-road-graph.json";
const OUT_PATH = snapshotPath;
const GRID_SIZE_DEG = 0.01;
const MAX_NEAREST_KM = 1.2;
const ANCHOR_GAP_KM = 0.8;
const MAX_ANCHORS = 80;
const MAX_EXPANSIONS = 70000;

const ROAD_MODES = ["bus", "serfis", "microbus"];
const DRIVE_MODE = 1;

function parseJson(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

function modeOfType(nameEn) {
  const n = String(nameEn || "").toLowerCase();
  if (n.includes("serfis")) return "serfis";
  if (n.includes("microbus")) return "microbus";
  if (n.includes("bus")) return "bus";
  if (n.includes("taxi") || n.includes("uber") || n.includes("careem") || n.includes("car")) return "taxi";
  if (n.includes("tuktuk") || n.includes("toktok")) return "tuktuk";
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

function gridKey(coord) {
  return `${Math.floor(coord[0] / GRID_SIZE_DEG)},${Math.floor(coord[1] / GRID_SIZE_DEG)}`;
}

class MinHeap {
  heap = [];
  push(item) {
    this.heap.push(item);
    let i = this.heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heap[p][0] <= item[0]) break;
      this.heap[i] = this.heap[p];
      i = p;
    }
    this.heap[i] = item;
  }
  pop() {
    if (!this.heap.length) return null;
    const root = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length && last) {
      let i = 0;
      while (true) {
        let child = i * 2 + 1;
        if (child >= this.heap.length) break;
        if (child + 1 < this.heap.length && this.heap[child + 1][0] < this.heap[child][0]) child++;
        if (this.heap[child][0] >= last[0]) break;
        this.heap[i] = this.heap[child];
        i = child;
      }
      this.heap[i] = last;
    }
    return root;
  }
  get size() {
    return this.heap.length;
  }
}

function buildGraph(raw) {
  const nodes = raw.nodes;
  const adjacency = Array.from({ length: nodes.length }, () => []);
  const grid = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const key = gridKey(nodes[i]);
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }
  for (const edge of raw.edges) {
    if (((edge[3] ?? DRIVE_MODE) & DRIVE_MODE) === 0) continue;
    adjacency[edge[0]]?.push([edge[1], edge[2] / 1000]);
  }
  return { nodes, adjacency, grid };
}

function nearestNode(graph, point) {
  const baseX = Math.floor(point[0] / GRID_SIZE_DEG);
  const baseY = Math.floor(point[1] / GRID_SIZE_DEG);
  let best = null;
  for (let radius = 0; radius <= 5; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const ids = graph.grid.get(`${baseX + dx},${baseY + dy}`);
        if (!ids) continue;
        for (const id of ids) {
          const km = haversineKm(point, graph.nodes[id]);
          if (km <= MAX_NEAREST_KM && (!best || km < best.km)) best = { id, km };
        }
      }
    }
    if (best) return best;
  }
  return best;
}

function routeBetween(graph, startId, endId) {
  if (startId === endId) return [startId];
  const open = new MinHeap();
  const cameFrom = new Int32Array(graph.nodes.length);
  const touched = [];
  cameFrom.fill(-1);
  const gScore = new Map([[startId, 0]]);
  open.push([haversineKm(graph.nodes[startId], graph.nodes[endId]), startId]);
  let expansions = 0;

  while (open.size && expansions < MAX_EXPANSIONS) {
    const current = open.pop()?.[1];
    if (current == null) break;
    if (current === endId) {
      const ids = [current];
      let cursor = current;
      while (cameFrom[cursor] >= 0) {
        cursor = cameFrom[cursor];
        ids.push(cursor);
      }
      return ids.reverse();
    }
    expansions++;
    const base = gScore.get(current) ?? Infinity;
    for (const [next, km] of graph.adjacency[current]) {
      const tentative = base + km;
      if (tentative >= (gScore.get(next) ?? Infinity)) continue;
      if (!gScore.has(next)) touched.push(next);
      cameFrom[next] = current;
      gScore.set(next, tentative);
      open.push([tentative + haversineKm(graph.nodes[next], graph.nodes[endId]), next]);
    }
  }
  void touched;
  return null;
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
  if (anchors.length <= MAX_ANCHORS) return anchors;
  const out = [];
  const step = (anchors.length - 1) / (MAX_ANCHORS - 1);
  for (let i = 0; i < MAX_ANCHORS; i++) out.push(anchors[Math.round(i * step)]);
  return out;
}

function compactPath(path) {
  const out = [];
  for (const point of path) {
    const prev = out[out.length - 1];
    if (!prev || haversineKm(prev, point) > 0.012) out.push([Number(point[0].toFixed(5)), Number(point[1].toFixed(5))]);
  }
  return out.length >= 2 ? out : path;
}

function matchRoute(graph, rawPath) {
  const anchors = anchorsFor(rawPath);
  const snapped = anchors.map((point) => nearestNode(graph, point));
  if (snapped.some((node) => !node)) return null;
  const out = [];
  let failed = 0;

  for (let i = 1; i < snapped.length; i++) {
    const route = routeBetween(graph, snapped[i - 1].id, snapped[i].id);
    if (!route || route.length < 2) {
      failed++;
      continue;
    }
    for (let j = 0; j < route.length; j++) {
      if (out.length && j === 0) continue;
      out.push(graph.nodes[route[j]]);
    }
  }

  if (failed > Math.max(1, Math.floor((snapped.length - 1) * 0.12))) return null;
  const matched = compactPath(out);
  const rawLen = Math.max(0.1, pathLengthKm(rawPath));
  const matchedLen = pathLengthKm(matched);
  if (matched.length < 2 || matchedLen > rawLen * 2.6 + 6) return null;
  return matched;
}

const [snapshot, graphRaw] = await Promise.all([
  readFile(snapshotPath, "utf8").then(parseJson),
  readFile(graphPath, "utf8").then(parseJson),
]);

const types = new Map(snapshot.types.map((type) => [type.id, type]));
const graph = buildGraph(graphRaw);
let matchedCount = 0;
let skippedCount = 0;
let failedCount = 0;

for (let i = 0; i < snapshot.lines.length; i++) {
  const line = snapshot.lines[i];
  const type = types.get(line.transportTypeId);
  const mode = modeOfType(type?.nameEn);
  if (!ROAD_MODES.includes(mode) || !Array.isArray(line.path) || line.path.length < 2) {
    skippedCount++;
    continue;
  }
  const matched = matchRoute(graph, line.path);
  if (!matched) {
    failedCount++;
    console.warn(`Failed: ${line.lineNumber || line.nameEn}`);
    continue;
  }
  line.path = matched;
  line.snapshotPointCount = matched.length;
  line.pathPointCount = Math.max(line.pathPointCount ?? 0, matched.length);
  line.maxStepMeters = Math.round(Math.max(...matched.slice(1).map((point, idx) => haversineKm(matched[idx], point) * 1000)));
  line.pathSuspect = false;
  line.routeQuality = "standard";
  matchedCount++;
  if (matchedCount % 25 === 0) console.log(`Matched ${matchedCount} routes...`);
}

snapshot.schemaVersion = Math.max(snapshot.schemaVersion ?? 2, 3);
snapshot.generatedAt = new Date().toISOString();
snapshot.revision = `${snapshot.schemaVersion}-matched-${Date.now()}-${snapshot.types.length}-${snapshot.lines.length}`;
await writeFile(OUT_PATH, JSON.stringify(snapshot), "utf8");
console.log(JSON.stringify({ matchedCount, skippedCount, failedCount, revision: snapshot.revision }, null, 2));
