import { readFile, writeFile } from "node:fs/promises";

const graphPath = "public/offline-road-graph.json";
const snapshotPath = "public/offline-snapshot.json";
const corridorRadiusDeg = 0.006;
const gridSizeDeg = 0.02;

function gridKey(lng, lat) {
  return `${Math.floor(lng / gridSizeDeg)},${Math.floor(lat / gridSizeDeg)}`;
}

function neighbors(lng, lat) {
  const x = Math.floor(lng / gridSizeDeg);
  const y = Math.floor(lat / gridSizeDeg);
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) out.push(`${x + dx},${y + dy}`);
  }
  return out;
}

function samplePath(path, maxPoints = 180) {
  if (path.length <= maxPoints) return path;
  const step = Math.ceil(path.length / maxPoints);
  const out = [];
  for (let i = 0; i < path.length; i += step) out.push(path[i]);
  out.push(path[path.length - 1]);
  return out;
}

function nearRoute(coord, routeGrid) {
  for (const key of neighbors(coord[0], coord[1])) {
    const points = routeGrid.get(key);
    if (!points) continue;
    for (const point of points) {
      if (Math.abs(coord[0] - point[0]) <= corridorRadiusDeg && Math.abs(coord[1] - point[1]) <= corridorRadiusDeg) {
        return true;
      }
    }
  }
  return false;
}

const [graph, snapshot] = await Promise.all([
  readFile(graphPath, "utf8").then((text) => JSON.parse(text.replace(/^\uFEFF/, ""))),
  readFile(snapshotPath, "utf8").then((text) => JSON.parse(text.replace(/^\uFEFF/, ""))),
]);

const routeGrid = new Map();
for (const line of snapshot.lines ?? []) {
  for (const point of samplePath(line.path ?? [])) {
    const key = gridKey(point[0], point[1]);
    const bucket = routeGrid.get(key);
    if (bucket) bucket.push(point);
    else routeGrid.set(key, [point]);
  }
}

const keepNode = new Uint8Array(graph.nodes.length);
for (let i = 0; i < graph.nodes.length; i++) {
  if (nearRoute(graph.nodes[i], routeGrid)) keepNode[i] = 1;
}

const remap = new Int32Array(graph.nodes.length);
remap.fill(-1);
const nodes = [];
for (let i = 0; i < graph.nodes.length; i++) {
  if (!keepNode[i]) continue;
  remap[i] = nodes.length;
  nodes.push(graph.nodes[i]);
}

const edges = [];
for (const edge of graph.edges) {
  const from = remap[edge[0]];
  const to = remap[edge[1]];
  if (from < 0 || to < 0) continue;
  edges.push([from, to, edge[2], edge[3], edge[4]]);
}

const compact = {
  ...graph,
  compactedAt: new Date().toISOString(),
  compactedForSnapshotRevision: snapshot.revision,
  corridorRadiusMetersApprox: Math.round(corridorRadiusDeg * 111000),
  nodes,
  edges,
};

await writeFile(graphPath, JSON.stringify(compact), "utf8");
console.log(`${graph.nodes.length} -> ${nodes.length} nodes`);
console.log(`${graph.edges.length} -> ${edges.length} directed edges`);
