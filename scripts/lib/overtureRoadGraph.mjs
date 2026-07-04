import { brotliDecompressSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';

const EARTH_KM = 6371;

export function distanceKm(a, b) {
  const rad = (degrees) => degrees * Math.PI / 180;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const lat1 = rad(a[1]);
  const lat2 = rad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

function lineLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index++) total += distanceKm(points[index - 1], points[index]);
  return total;
}

function pointAtFraction(points, fraction) {
  if (fraction <= 0) return points[0];
  if (fraction >= 1) return points[points.length - 1];
  const lengths = [];
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    const length = distanceKm(points[index - 1], points[index]);
    lengths.push(length);
    total += length;
  }
  const target = total * fraction;
  let walked = 0;
  for (let index = 0; index < lengths.length; index++) {
    if (walked + lengths[index] >= target) {
      const ratio = lengths[index] > 0 ? (target - walked) / lengths[index] : 0;
      return [
        points[index][0] + (points[index + 1][0] - points[index][0]) * ratio,
        points[index][1] + (points[index + 1][1] - points[index][1]) * ratio,
      ];
    }
    walked += lengths[index];
  }
  return points[points.length - 1];
}

function sliceLine(points, fromFraction, toFraction) {
  if (fromFraction === toFraction) return [pointAtFraction(points, fromFraction)];
  const reverse = fromFraction > toFraction;
  const start = reverse ? toFraction : fromFraction;
  const end = reverse ? fromFraction : toFraction;
  const lengths = [];
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    const length = distanceKm(points[index - 1], points[index]);
    lengths.push(length);
    total += length;
  }
  if (total <= 0) return [points[0]];
  const result = [pointAtFraction(points, start)];
  let walked = 0;
  for (let index = 0; index < lengths.length; index++) {
    walked += lengths[index];
    const fraction = walked / total;
    if (fraction > start + 1e-9 && fraction < end - 1e-9) result.push(points[index + 1]);
  }
  result.push(pointAtFraction(points, end));
  return reverse ? result.reverse() : result;
}

function modeApplies(restriction, mode) {
  const modes = restriction?.when?.mode;
  if (!Array.isArray(modes) || modes.length === 0) return true;
  const normalized = modes.map((value) => String(value).toLowerCase());
  if (mode === 'pedestrian') return normalized.some((value) => value.includes('pedestrian') || value.includes('foot'));
  return normalized.some((value) =>
    value.includes('vehicle') || value.includes('motor') || value.includes('bus') || value.includes('taxi') || value.includes('car'),
  );
}

function intervalsOverlap(restrictionBetween, edgeStart, edgeEnd) {
  if (!Array.isArray(restrictionBetween) || restrictionBetween.length < 2) return true;
  const start = Math.min(Number(restrictionBetween[0]), Number(restrictionBetween[1]));
  const end = Math.max(Number(restrictionBetween[0]), Number(restrictionBetween[1]));
  return start < edgeEnd - 1e-9 && end > edgeStart + 1e-9;
}

function directionAllowed(restrictions, heading, mode, edgeStart, edgeEnd) {
  for (const restriction of restrictions ?? []) {
    if (restriction?.access_type !== 'denied' || !modeApplies(restriction, mode)) continue;
    if (!intervalsOverlap(restriction.between, edgeStart, edgeEnd)) continue;
    const restrictedHeading = restriction?.when?.heading;
    if (!restrictedHeading || restrictedHeading === heading) return false;
  }
  return true;
}

function speedKmh(roadClass, mode) {
  if (mode === 'pedestrian') return 4.5;
  const speeds = {
    motorway: 80,
    trunk: 65,
    primary: 48,
    secondary: 38,
    tertiary: 30,
    residential: 22,
    service: 14,
    living_street: 12,
    unclassified: 20,
  };
  return speeds[roadClass] ?? 18;
}

function gridKey(point, size) {
  return `${Math.floor(point[0] / size)},${Math.floor(point[1] / size)}`;
}

class MinHeap {
  constructor() { this.items = []; }
  push(item) {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent][0] <= item[0]) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }
  pop() {
    if (!this.items.length) return null;
    const root = this.items[0];
    const tail = this.items.pop();
    if (this.items.length && tail) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.items.length) break;
        const child = right < this.items.length && this.items[right][0] < this.items[left][0] ? right : left;
        if (this.items[child][0] >= tail[0]) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = tail;
    }
    return root;
  }
}

export function createRoadGraphBuilder({ mode = 'road' } = {}) {
  const nodeIndex = new Map();
  const nodes = [];
  const edges = [];
  const segments = [];

  function ensureNode(id, point) {
    const existing = nodeIndex.get(id);
    if (existing !== undefined) return existing;
    const index = nodes.length;
    nodeIndex.set(id, index);
    nodes.push([Number(point[0]), Number(point[1])]);
    return index;
  }

  function addFeature(feature) {
    const geometry = feature.geometry;
    if (feature.subtype !== 'road' || geometry?.type !== 'LineString' || geometry.coordinates?.length < 2) return;
    const points = geometry.coordinates.map((point) => [Number(point[0]), Number(point[1])]);
    const connectors = [...(feature.connectors ?? [])]
      .filter((connector) => connector?.connector_id && Number.isFinite(Number(connector.at)))
      .sort((a, b) => Number(a.at) - Number(b.at));
    if (connectors.length < 2) return;
    const segmentIndex = segments.length;
    segments.push({ id: feature.id, class: feature.class ?? 'unclassified', name: feature.name ?? null });
    for (let index = 1; index < connectors.length; index++) {
      const fromConnector = connectors[index - 1];
      const toConnector = connectors[index];
      const fromFraction = Number(fromConnector.at);
      const toFraction = Number(toConnector.at);
      if (toFraction - fromFraction < 1e-8) continue;
      const forwardGeometry = sliceLine(points, fromFraction, toFraction);
      if (forwardGeometry.length < 2) continue;
      const from = ensureNode(fromConnector.connector_id, forwardGeometry[0]);
      const to = ensureNode(toConnector.connector_id, forwardGeometry[forwardGeometry.length - 1]);
      const lengthKm = lineLength(forwardGeometry);
      const travelCost = lengthKm / speedKmh(feature.class, mode);
      if (directionAllowed(feature.access_restrictions, 'forward', mode, fromFraction, toFraction)) {
        edges.push({ from, to, cost: travelCost, lengthKm, segmentIndex, geometry: forwardGeometry });
      }
      if (directionAllowed(feature.access_restrictions, 'backward', mode, fromFraction, toFraction)) {
        edges.push({ from: to, to: from, cost: travelCost, lengthKm, segmentIndex, geometry: [...forwardGeometry].reverse() });
      }
    }
  }

  return {
    addFeature,
    finish: () => ({ schemaVersion: 1, mode, nodes, edges, segments }),
  };
}

export function buildRoadGraph(features, options = {}) {
  const builder = createRoadGraphBuilder(options);
  for (const feature of features) builder.addFeature(feature);
  return builder.finish();
}

export class OvertureRoadRouter {
  constructor(graph) {
    this.graph = graph;
    this.adjacency = Array.from({ length: graph.nodes.length }, () => []);
    graph.edges.forEach((edge, index) => this.adjacency[edge.from].push(index));
    this.gridSize = 0.015;
    this.grid = new Map();
    graph.nodes.forEach((point, index) => {
      const key = gridKey(point, this.gridSize);
      const values = this.grid.get(key) ?? [];
      values.push(index);
      this.grid.set(key, values);
    });
  }

  nearestNode(point, maxDistanceKm = 1.2) {
    const centerX = Math.floor(point[0] / this.gridSize);
    const centerY = Math.floor(point[1] / this.gridSize);
    let best = null;
    for (let radius = 0; radius <= 3; radius++) {
      for (let x = centerX - radius; x <= centerX + radius; x++) {
        for (let y = centerY - radius; y <= centerY + radius; y++) {
          for (const node of this.grid.get(`${x},${y}`) ?? []) {
            const distance = distanceKm(point, this.graph.nodes[node]);
            if (!best || distance < best.distanceKm) best = { node, distanceKm: distance };
          }
        }
      }
      if (best && best.distanceKm <= maxDistanceKm) break;
    }
    return best && best.distanceKm <= maxDistanceKm ? best : null;
  }

  routeNodes(start, end, maxVisited = 300_000) {
    const queue = new MinHeap();
    const distance = new Float64Array(this.graph.nodes.length);
    distance.fill(Number.POSITIVE_INFINITY);
    const previousEdge = new Int32Array(this.graph.nodes.length);
    previousEdge.fill(-1);
    distance[start] = 0;
    queue.push([0, start]);
    let visited = 0;

    while (queue.items.length && visited < maxVisited) {
      const current = queue.pop();
      if (!current) break;
      const [, node] = current;
      if (node === end) break;
      visited++;
      for (const edgeIndex of this.adjacency[node]) {
        const edge = this.graph.edges[edgeIndex];
        const candidate = distance[node] + edge.cost;
        if (candidate >= distance[edge.to]) continue;
        distance[edge.to] = candidate;
        previousEdge[edge.to] = edgeIndex;
        const heuristic = distanceKm(this.graph.nodes[edge.to], this.graph.nodes[end]) / 80;
        queue.push([candidate + heuristic, edge.to]);
      }
    }
    if (!Number.isFinite(distance[end])) return null;
    const routeEdges = [];
    let node = end;
    while (node !== start) {
      const edgeIndex = previousEdge[node];
      if (edgeIndex < 0) return null;
      routeEdges.push(edgeIndex);
      node = this.graph.edges[edgeIndex].from;
    }
    routeEdges.reverse();
    const geometry = [];
    for (const edgeIndex of routeEdges) {
      const points = this.graph.edges[edgeIndex].geometry;
      geometry.push(...(geometry.length ? points.slice(1) : points));
    }
    return { geometry, edgeIndexes: routeEdges, cost: distance[end], visited };
  }

  routeThrough(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const snaps = points.map((point) => this.nearestNode(point));
    if (snaps.some((snap) => !snap)) return null;
    const geometry = [];
    const edgeIndexes = [];
    for (let index = 1; index < snaps.length; index++) {
      const section = this.routeNodes(snaps[index - 1].node, snaps[index].node);
      if (!section?.geometry?.length) return null;
      const previous = geometry[geometry.length - 1];
      const first = section.geometry[0];
      if (previous && distanceKm(previous, first) > 0.03) return null;
      geometry.push(...(geometry.length ? section.geometry.slice(1) : section.geometry));
      edgeIndexes.push(...section.edgeIndexes);
    }
    return { geometry, edgeIndexes, snaps };
  }
}

export async function loadRoadGraph(filePath) {
  const compressed = await readFile(filePath);
  const json = filePath.endsWith('.br') ? brotliDecompressSync(compressed).toString('utf8') : compressed.toString('utf8');
  return JSON.parse(json);
}
