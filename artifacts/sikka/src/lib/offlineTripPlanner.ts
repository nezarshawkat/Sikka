type LngLat = [number, number];
type Coord = { lat: number; lng: number };
type PlanKey = "economic" | "comfortable" | "premium";
type ModeKey = "metro" | "monorail" | "train" | "tram" | "bus" | "serfis" | "microbus" | "taxi" | "tuktuk" | "walk";

type OfflineType = {
  id: string;
  nameEn: string;
  nameAr: string;
  icon: string;
  color: string;
  category: string;
  governmentType: string;
  averageSpeedKmh: number;
  basePriceEgp: number;
  pricePerKmEgp: number;
};

type OfflineLine = {
  id: string;
  transportTypeId: string;
  lineNumber: string | null;
  nameEn: string;
  nameAr: string;
  fromArea: string;
  toArea: string;
  governorate: string;
  viaStops: string[];
  path: LngLat[];
  pathPointCount?: number;
  snapshotPointCount?: number;
  maxStepMeters?: number;
  pathSuspect?: boolean;
  routeQuality?: "gtfs" | "discovered" | "recorded" | "standard" | "rough" | "suspect";
  updatedAt?: string;
  deleted?: boolean;
  priceEgp: number;
  frequencyMinutes: number | null;
  hasFixedStops: boolean;
};

type OfflineSnapshot = {
  schemaVersion: number;
  generatedAt: string;
  revision: string;
  types: OfflineType[];
  lines: OfflineLine[];
};

type PlannerRequest = {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  destination: string;
  tripType: string;
  budget?: number | null;
  language: string;
  mode?: string;
};

type ApiAlternative = {
  transport_type_id: string;
  transport_name: string;
  cost_egp: number;
  duration_minutes: number;
  color: string;
  icon: string;
  line_id?: string | null;
  line_number?: string | null;
  info?: string;
  instructions?: string[];
  route_geometry?: LngLat[] | null;
};

type ApiSegment = ApiAlternative & {
  government_type: string;
  category: string;
  start_name: string;
  end_name: string;
  line_id: string | null;
  line_number: string | null;
  alternatives: ApiAlternative[];
};

type ApiPlan = {
  segments: ApiSegment[];
  total_cost_egp: number;
  total_duration_minutes: number;
  budget_range: { min: number; max: number };
  distance_km: number;
  offline?: boolean;
  snapshot_revision?: string;
};

type Candidate = {
  line: OfflineLine;
  type: OfflineType;
  mode: ModeKey;
  closest: ClosestPoint;
};

type ClosestPoint = {
  coord: Coord;
  index: number;
  distanceKm: number;
};

type Connector = {
  mode: ModeKey;
  nameEn: string;
  nameAr: string;
  color: string;
  icon: string;
  cost: number;
  minutes: number;
  geometry: LngLat[];
};

type OfflineChanges = {
  schemaVersion: number;
  generatedAt: string;
  revision: string;
  latestStamp?: number;
  types: OfflineType[];
  lines: OfflineLine[];
};

type GraphEdge = {
  to: string;
  km: number;
  modes?: number;
};

type GraphNode = {
  id: string;
  coord: Coord;
  edges: GraphEdge[];
};

type ConnectorGraph = {
  nodes: Map<string, GraphNode>;
  grid: Map<string, string[]>;
};

const DEFAULT_API_ORIGIN = "https://sikka-mq6w.onrender.com";
const API_ORIGIN = ((import.meta.env.VITE_API_URL as string | undefined) || DEFAULT_API_ORIGIN).replace(/\/+$/, "");
const API_BASE = `${API_ORIGIN}/api`;
const SNAPSHOT_DB = "sikka-offline";
const SNAPSHOT_STORE = "snapshots";
const SNAPSHOT_KEY = "latest";
const SNAPSHOT_SCHEMA_VERSION = 3;
const MIN_COMPATIBLE_SNAPSHOT_SCHEMA_VERSION = 2;
const SNAPSHOT_REFRESH_MS = 10 * 60 * 1000;
const SNAPSHOT_FETCH_TIMEOUT_MS = 20 * 1000;
const BUNDLED_SNAPSHOT_URL = "/offline-snapshot.json";
const BUNDLED_ROAD_GRAPH_URL = "/offline-road-graph.json";
const WALK_MAX_KM = 0.8;
const WALK_SPEED_KMH = 4.5;
const WALK_DETOUR = 1.3;
const FARE_MARKUP = 1.25;
const GRAPH_CELL_SIZE_DEG = 0.01;
const GRAPH_MAX_NEAREST_KM = 0.75;
const GRAPH_MAX_EDGE_KM = 0.5;
const GRAPH_MAX_EXPANSIONS = 18000;
const ROAD_MODE_DRIVE = 1;
const ROAD_MODE_WALK = 2;

type RoadGraphJson = {
  schemaVersion: number;
  nodes: LngLat[];
  edges: [number, number, number, number?, number?][];
};

let roadGraphPromise: Promise<ConnectorGraph | null> | null = null;

export class OfflineRouteError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "OfflineRouteError";
  }
}

function modeOfType(nameEn: string): ModeKey {
  const n = nameEn.toLowerCase();
  if (n.includes("metro")) return "metro";
  if (n.includes("monorail")) return "monorail";
  if (n.includes("tram")) return "tram";
  if (n.includes("train")) return "train";
  if (n.includes("serfis")) return "serfis";
  if (n.includes("microbus")) return "microbus";
  if (n.includes("tuktuk") || n.includes("toktok")) return "tuktuk";
  if (n.includes("taxi") || n.includes("uber") || n.includes("careem") || n.includes("car")) return "taxi";
  if (n.includes("bus")) return "bus";
  return "bus";
}

function allowedModes(planKey: PlanKey): Set<ModeKey> {
  if (planKey === "economic") return new Set(["metro", "monorail", "train", "tram", "bus", "serfis", "microbus", "tuktuk"]);
  if (planKey === "comfortable") return new Set(["metro", "monorail", "train", "tram", "bus", "serfis", "taxi", "tuktuk"]);
  return new Set(["metro", "monorail", "train", "tram", "bus", "serfis", "taxi", "tuktuk"]);
}

function haversineKm(a: Coord, b: Coord): number {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function maxConsecutiveStepKm(path: LngLat[]): number {
  let max = 0;
  for (let i = 1; i < path.length; i++) {
    max = Math.max(max, haversineKm({ lng: path[i - 1][0], lat: path[i - 1][1] }, { lng: path[i][0], lat: path[i][1] }));
  }
  return max;
}

function routeQuality(line: OfflineLine): NonNullable<OfflineLine["routeQuality"]> {
  if (line.routeQuality) return line.routeQuality;
  if (line.pathSuspect || maxConsecutiveStepKm(line.path) > 0.5) return "suspect";
  if ((line.maxStepMeters ?? 0) > 180) return "rough";
  if (line.hasFixedStops) return "gtfs";
  return (line.pathPointCount ?? line.path.length) >= 50 ? "recorded" : "standard";
}

function routeQualityPenalty(line: OfflineLine): number {
  const quality = routeQuality(line);
  if (quality === "gtfs") return -45;
  if (quality === "discovered") return -60;
  if (quality === "recorded") return -35;
  if (quality === "rough") return 35;
  if (quality === "suspect") return 70;
  return 0;
}

function modePreferencePenalty(mode: ModeKey, planKey: PlanKey): number {
  if (planKey === "economic") {
    if (mode === "metro" || mode === "train" || mode === "bus") return -12;
    if (mode === "microbus" || mode === "serfis") return 0;
    if (mode === "taxi") return 90;
  }
  if (planKey === "comfortable") {
    if (mode === "metro" || mode === "train" || mode === "bus") return -18;
    if (mode === "microbus") return 85;
    if (mode === "taxi" || mode === "tuktuk") return 18;
  }
  if (planKey === "premium") {
    if (mode === "taxi") return -20;
    if (mode === "metro" || mode === "train") return -10;
    if (mode === "microbus") return 120;
  }
  return 0;
}

function connectorModeFromSegment(segment: ApiSegment): ModeKey | null {
  if (segment.line_id) return null;
  if (segment.transport_type_id === "walk" || segment.icon === "walk") return "walk";
  if (segment.transport_type_id === "tuktuk" || segment.icon === "tuktuk" || segment.icon === "bike") return "tuktuk";
  if (segment.transport_type_id === "taxi" || segment.icon === "car") return "taxi";
  return null;
}

function coordKey(point: LngLat): string {
  return `${point[0].toFixed(5)},${point[1].toFixed(5)}`;
}

function graphGridKey(coord: Coord): string {
  return `${Math.floor(coord.lng / GRAPH_CELL_SIZE_DEG)},${Math.floor(coord.lat / GRAPH_CELL_SIZE_DEG)}`;
}

function addGraphNode(graph: ConnectorGraph, point: LngLat): GraphNode {
  const id = coordKey(point);
  const existing = graph.nodes.get(id);
  if (existing) return existing;
  const node: GraphNode = { id, coord: { lng: point[0], lat: point[1] }, edges: [] };
  graph.nodes.set(id, node);
  const cell = graphGridKey(node.coord);
  const bucket = graph.grid.get(cell);
  if (bucket) bucket.push(id);
  else graph.grid.set(cell, [id]);
  return node;
}

function addGraphEdge(graph: ConnectorGraph, from: LngLat, to: LngLat, modes = ROAD_MODE_DRIVE | ROAD_MODE_WALK): void {
  const km = haversineKm({ lng: from[0], lat: from[1] }, { lng: to[0], lat: to[1] });
  if (!Number.isFinite(km) || km <= 0 || km > GRAPH_MAX_EDGE_KM) return;
  const a = addGraphNode(graph, from);
  const b = addGraphNode(graph, to);
  a.edges.push({ to: b.id, km, modes });
  b.edges.push({ to: a.id, km, modes });
}

function buildConnectorGraph(snapshot: OfflineSnapshot): ConnectorGraph {
  const graph: ConnectorGraph = { nodes: new Map(), grid: new Map() };
  for (const line of snapshot.lines) {
    if (!line.path || line.path.length < 2 || routeQuality(line) === "suspect") continue;
    for (let i = 1; i < line.path.length; i++) {
      addGraphEdge(graph, line.path[i - 1], line.path[i]);
    }
  }
  return graph;
}

function buildRoadConnectorGraph(roadGraph: RoadGraphJson): ConnectorGraph | null {
  if (!Array.isArray(roadGraph.nodes) || !Array.isArray(roadGraph.edges) || roadGraph.nodes.length < 2) return null;
  const graph: ConnectorGraph = { nodes: new Map(), grid: new Map() };
  for (let i = 0; i < roadGraph.nodes.length; i++) {
    const point = roadGraph.nodes[i];
    const node: GraphNode = { id: String(i), coord: { lng: point[0], lat: point[1] }, edges: [] };
    graph.nodes.set(node.id, node);
    const cell = graphGridKey(node.coord);
    const bucket = graph.grid.get(cell);
    if (bucket) bucket.push(node.id);
    else graph.grid.set(cell, [node.id]);
  }
  for (const edge of roadGraph.edges) {
    const from = graph.nodes.get(String(edge[0]));
    const to = graph.nodes.get(String(edge[1]));
    if (!from || !to) continue;
    const km = edge[2] / 1000;
    if (!Number.isFinite(km) || km <= 0 || km > 3) continue;
    from.edges.push({ to: to.id, km, modes: edge[3] ?? (ROAD_MODE_DRIVE | ROAD_MODE_WALK) });
  }
  return graph.nodes.size ? graph : null;
}

async function getRoadConnectorGraph(): Promise<ConnectorGraph | null> {
  if (!roadGraphPromise) {
    roadGraphPromise = fetch(BUNDLED_ROAD_GRAPH_URL, { cache: "force-cache" })
      .then((res) => res.ok ? res.json() : null)
      .then((json) => json ? buildRoadConnectorGraph(json as RoadGraphJson) : null)
      .catch(() => null);
  }
  return roadGraphPromise;
}

function nearestGraphNode(graph: ConnectorGraph, point: Coord): { node: GraphNode; km: number } | null {
  let best: { node: GraphNode; km: number } | null = null;
  const baseX = Math.floor(point.lng / GRAPH_CELL_SIZE_DEG);
  const baseY = Math.floor(point.lat / GRAPH_CELL_SIZE_DEG);
  for (let radius = 0; radius <= 4; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const ids = graph.grid.get(`${baseX + dx},${baseY + dy}`);
        if (!ids) continue;
        for (const id of ids) {
          const node = graph.nodes.get(id);
          if (!node) continue;
          const km = haversineKm(point, node.coord);
          if (km <= GRAPH_MAX_NEAREST_KM && (!best || km < best.km)) best = { node, km };
        }
      }
    }
    if (best) return best;
  }
  return best;
}

function reconstructGraphPath(cameFrom: Map<string, string>, current: string, graph: ConnectorGraph): LngLat[] {
  const ids = [current];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    ids.push(current);
  }
  ids.reverse();
  return ids
    .map((id) => graph.nodes.get(id))
    .filter((node): node is GraphNode => Boolean(node))
    .map((node) => [node.coord.lng, node.coord.lat] as LngLat);
}

function routeOnConnectorGraph(graph: ConnectorGraph, from: Coord, to: Coord, mode: ModeKey): LngLat[] | null {
  if (!graph.nodes.size) return null;
  const start = nearestGraphNode(graph, from);
  const end = nearestGraphNode(graph, to);
  if (!start || !end || start.node.id === end.node.id) return null;
  const requiredMode = mode === "walk" ? ROAD_MODE_WALK : ROAD_MODE_DRIVE;

  const open = new Set<string>([start.node.id]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[start.node.id, start.km]]);
  const fScore = new Map<string, number>([[start.node.id, start.km + haversineKm(start.node.coord, end.node.coord)]]);
  let expansions = 0;

  while (open.size && expansions < GRAPH_MAX_EXPANSIONS) {
    let current: string | null = null;
    let currentScore = Infinity;
    for (const id of open) {
      const score = fScore.get(id) ?? Infinity;
      if (score < currentScore) {
        current = id;
        currentScore = score;
      }
    }
    if (!current) break;
    if (current === end.node.id) {
      const path = reconstructGraphPath(cameFrom, current, graph);
      return [[from.lng, from.lat], ...path, [to.lng, to.lat]];
    }

    open.delete(current);
    expansions++;
    const node = graph.nodes.get(current);
    if (!node) continue;
    const base = gScore.get(current) ?? Infinity;
    for (const edge of node.edges) {
      if (edge.modes && (edge.modes & requiredMode) === 0) continue;
      const next = graph.nodes.get(edge.to);
      if (!next) continue;
      const tentative = base + edge.km;
      if (tentative >= (gScore.get(edge.to) ?? Infinity)) continue;
      cameFrom.set(edge.to, current);
      gScore.set(edge.to, tentative);
      fScore.set(edge.to, tentative + haversineKm(next.coord, end.node.coord) + end.km);
      open.add(edge.to);
    }
  }
  return null;
}

async function snapConnectorGeometry(mode: ModeKey, geometry: LngLat[], graph: ConnectorGraph): Promise<LngLat[]> {
  if (geometry.length < 2) return geometry;
  if (mode !== "walk" && mode !== "taxi" && mode !== "tuktuk") return geometry;
  const graphRoute = routeOnConnectorGraph(
    graph,
    { lng: geometry[0][0], lat: geometry[0][1] },
    { lng: geometry[geometry.length - 1][0], lat: geometry[geometry.length - 1][1] },
    mode,
  );
  if (graphRoute && graphRoute.length >= 2) {
    const directKm = haversineKm(
      { lng: geometry[0][0], lat: geometry[0][1] },
      { lng: geometry[geometry.length - 1][0], lat: geometry[geometry.length - 1][1] },
    );
    const maxDetour = directKm * (mode === "walk" ? 2.2 : 3) + 0.4;
    if (pathLengthKm(graphRoute) <= maxDetour) return graphRoute;
  }
  const out: LngLat[] = [geometry[0]];
  for (let i = 1; i < geometry.length; i++) {
    const from = geometry[i - 1];
    const to = geometry[i];
    const km = haversineKm({ lng: from[0], lat: from[1] }, { lng: to[0], lat: to[1] });
    const steps = Math.max(1, Math.ceil(km / 0.06));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      out.push([
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
      ]);
    }
  }
  return out;
}

function pointToSegment(point: Coord, a: LngLat, b: LngLat): { coord: Coord; distanceKm: number } {
  const r = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (d: number) => (d * 180) / Math.PI;
  const cosLat = Math.max(Math.cos(toRad(point.lat)), 0.000001);
  const ax = toRad(a[0] - point.lng) * cosLat * r;
  const ay = toRad(a[1] - point.lat) * r;
  const bx = toRad(b[0] - point.lng) * cosLat * r;
  const by = toRad(b[1] - point.lat) * r;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (-ax * dx + -ay * dy) / len2)) : 0;
  const px = ax + dx * t;
  const py = ay + dy * t;
  return {
    distanceKm: Math.hypot(px, py),
    coord: { lng: point.lng + toDeg(px / (cosLat * r)), lat: point.lat + toDeg(py / r) },
  };
}

function closestPointOnPath(path: LngLat[], point: Coord): ClosestPoint {
  let best: ClosestPoint = { coord: { lat: path[0][1], lng: path[0][0] }, index: 0, distanceKm: Infinity };
  for (let i = 0; i < path.length - 1; i++) {
    const projected = pointToSegment(point, path[i], path[i + 1]);
    if (projected.distanceKm < best.distanceKm) best = { ...projected, index: i };
  }
  return best;
}

function pathLengthKm(path: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineKm({ lng: path[i - 1][0], lat: path[i - 1][1] }, { lng: path[i][0], lat: path[i][1] });
  return total;
}

function slicePath(path: LngLat[], fromIdx: number, toIdx: number): LngLat[] {
  const a = Math.max(0, Math.min(fromIdx, path.length - 1));
  const b = Math.max(0, Math.min(toIdx, path.length - 1));
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const sliced = path.slice(lo, hi + 1);
  const oriented = a <= b ? sliced : sliced.reverse();
  return oriented.length >= 2 ? oriented : [path[a], path[b]];
}

function samplePath(path: LngLat[], maxPoints = 42): { point: LngLat; index: number }[] {
  const step = Math.max(1, Math.ceil(path.length / maxPoints));
  const out: { point: LngLat; index: number }[] = [];
  for (let i = 0; i < path.length; i += step) out.push({ point: path[i], index: i });
  if (out[out.length - 1]?.index !== path.length - 1) out.push({ point: path[path.length - 1], index: path.length - 1 });
  return out;
}

function walkMinutes(km: number): number {
  return ((km * WALK_DETOUR) / WALK_SPEED_KMH) * 60;
}

function connectorFor(distanceKm: number, from: Coord, to: Coord, planKey: PlanKey): Connector | null {
  const geometry: LngLat[] = [[from.lng, from.lat], [to.lng, to.lat]];
  if (distanceKm <= WALK_MAX_KM) {
    return { mode: "walk", nameEn: "Walk", nameAr: "مشي", color: "#64748B", icon: "walk", cost: 0, minutes: walkMinutes(distanceKm), geometry };
  }
  if (planKey === "economic" && distanceKm <= 3.5) {
    return { mode: "tuktuk", nameEn: "Tuktuk", nameAr: "توك توك", color: "#F59E0B", icon: "tuktuk", cost: Math.round(8 + distanceKm * 7), minutes: (distanceKm / 22) * 60, geometry };
  }
  if (planKey !== "economic" && distanceKm <= 5) {
    return { mode: "taxi", nameEn: "Taxi app", nameAr: "تطبيق تاكسي", color: "#111827", icon: "car", cost: Math.round(15 + distanceKm * 5), minutes: (distanceKm / 28) * 60, geometry };
  }
  return null;
}

function directTaxiConnector(distanceKm: number, from: Coord, to: Coord): Connector {
  return {
    mode: "taxi",
    nameEn: "Taxi app",
    nameAr: "تطبيق تاكسي",
    color: "#111827",
    icon: "car",
    cost: Math.round(18 + distanceKm * 6),
    minutes: (distanceKm / 32) * 60,
    geometry: [[from.lng, from.lat], [to.lng, to.lat]],
  };
}

function lineFare(type: OfflineType, line: OfflineLine, km: number): number {
  if (type.pricePerKmEgp > 0) return Math.round((type.basePriceEgp + type.pricePerKmEgp * km) * FARE_MARKUP);
  return Math.round((line.priceEgp || type.basePriceEgp || 5) * FARE_MARKUP);
}

function waitMinutes(line: OfflineLine, mode: ModeKey): number {
  const defaults: Record<ModeKey, number> = { metro: 6, monorail: 8, train: 30, tram: 8, bus: 18, serfis: 10, microbus: 10, taxi: 6, tuktuk: 5, walk: 0 };
  return Math.max(0, (line.frequencyMinutes ?? defaults[mode]) / 2);
}

function transportName(type: OfflineType, line: OfflineLine, isArabic: boolean): string {
  const lineName = isArabic ? line.nameAr : line.nameEn;
  const typeName = isArabic ? type.nameAr : type.nameEn;
  return line.lineNumber ? `${typeName} ${line.lineNumber}` : lineName || typeName;
}

function connectorSegment(connector: Connector, startName: string, endName: string, isArabic: boolean): ApiSegment {
  return {
    transport_type_id: connector.mode,
    transport_name: isArabic ? connector.nameAr : connector.nameEn,
    government_type: "private",
    category: connector.mode === "walk" ? "economic" : "comfortable",
    start_name: startName,
    end_name: endName,
    cost_egp: Math.round(connector.cost),
    duration_minutes: Math.max(1, Math.round(connector.minutes)),
    color: connector.color,
    icon: connector.icon,
    line_id: null,
    line_number: null,
    route_geometry: connector.geometry,
    alternatives: [],
  };
}

function rideSegment(candidate: Candidate, from: ClosestPoint, to: ClosestPoint, isArabic: boolean): ApiSegment {
  const route = slicePath(candidate.line.path, from.index, to.index);
  const km = Math.max(0.2, pathLengthKm(route));
  const minutes = waitMinutes(candidate.line, candidate.mode) + (km / Math.max(candidate.type.averageSpeedKmh || 25, 8)) * 60;
  return {
    transport_type_id: candidate.type.id,
    transport_name: transportName(candidate.type, candidate.line, isArabic),
    government_type: candidate.type.governmentType,
    category: candidate.type.category,
    start_name: candidate.line.fromArea,
    end_name: candidate.line.toArea,
    cost_egp: lineFare(candidate.type, candidate.line, km),
    duration_minutes: Math.max(2, Math.round(minutes)),
    color: candidate.type.color,
    icon: candidate.type.icon || candidate.mode,
    line_id: candidate.line.id,
    line_number: candidate.line.lineNumber,
    info: isArabic
      ? `محسوبة على الهاتف من بيانات Sikka المحفوظة. آخر تحديث للبيانات يتم بالمزامنة.`
      : `Calculated on this phone from the synced Sikka route snapshot.`,
    instructions: isArabic
      ? [`اتجه إلى أقرب نقطة على خط ${transportName(candidate.type, candidate.line, true)}.`, `اركب باتجاه ${candidate.line.toArea}.`]
      : [`Go to the nearest point on ${transportName(candidate.type, candidate.line, false)}.`, `Ride toward ${candidate.line.toArea}.`],
    route_geometry: route,
    alternatives: [],
  };
}

function toAlternative(segment: ApiSegment): ApiAlternative {
  return {
    transport_type_id: segment.transport_type_id,
    transport_name: segment.transport_name,
    cost_egp: segment.cost_egp,
    duration_minutes: segment.duration_minutes,
    color: segment.color,
    icon: segment.icon,
    line_id: segment.line_id,
    line_number: segment.line_number,
    info: segment.info,
    instructions: segment.instructions,
    route_geometry: segment.route_geometry,
  };
}

function buildRideAlternatives(
  snapshot: OfflineSnapshot,
  segment: ApiSegment,
  planKey: PlanKey,
  isArabic: boolean,
): ApiAlternative[] {
  if (!segment.line_id || !segment.route_geometry || segment.route_geometry.length < 2) return [];
  const startPoint = segment.route_geometry[0];
  const endPoint = segment.route_geometry[segment.route_geometry.length - 1];
  const start = { lat: startPoint[1], lng: startPoint[0] };
  const end = { lat: endPoint[1], lng: endPoint[0] };
  const starts = buildCandidates(snapshot, start, planKey, 40);
  const ends = buildCandidates(snapshot, end, planKey, 40);
  const alternatives: ApiAlternative[] = [];
  const seen = new Set<string>();

  for (const a of starts) {
    if (a.line.id === segment.line_id || seen.has(a.line.id)) continue;
    const b = ends.find((candidate) => candidate.line.id === a.line.id);
    if (!b) continue;
    const ride = rideSegment(a, a.closest, b.closest, isArabic);
    if (ride.route_geometry && ride.route_geometry.length >= 2) {
      alternatives.push(toAlternative(ride));
      seen.add(a.line.id);
    }
    if (alternatives.length >= 4) break;
  }

  alternatives.sort((a, b) => (a.cost_egp + a.duration_minutes) - (b.cost_egp + b.duration_minutes));
  return alternatives;
}

function attachAlternatives(
  snapshot: OfflineSnapshot,
  segments: ApiSegment[],
  planKey: PlanKey,
  isArabic: boolean,
): ApiSegment[] {
  return segments.map((segment) => ({
    ...segment,
    alternatives: segment.line_id ? buildRideAlternatives(snapshot, segment, planKey, isArabic) : segment.alternatives,
  }));
}

function scoreSegments(segments: ApiSegment[], planKey: PlanKey): number {
  const totalCost = segments.reduce((sum, s) => sum + s.cost_egp, 0);
  const totalTime = segments.reduce((sum, s) => sum + s.duration_minutes, 0);
  const transfers = Math.max(0, segments.filter((s) => s.line_id).length - 1);
  const costWeight = planKey === "economic" ? 2.6 : planKey === "comfortable" ? 1 : 0.25;
  const timeWeight = planKey === "economic" ? 0.7 : planKey === "comfortable" ? 1.25 : 2.2;
  const connectorPenalty = segments.reduce((sum, s) => {
    const mode = connectorModeFromSegment(s);
    return sum + (mode ? modePreferencePenalty(mode, planKey) : 0);
  }, 0);
  return totalCost * costWeight + totalTime * timeWeight + transfers * 15 + connectorPenalty;
}

async function snapConnectorSegments(segments: ApiSegment[], graph: ConnectorGraph): Promise<ApiSegment[]> {
  return Promise.all(segments.map(async (segment) => {
    const mode = connectorModeFromSegment(segment);
    if (!mode || !segment.route_geometry) return segment;
    return { ...segment, route_geometry: await snapConnectorGeometry(mode, segment.route_geometry, graph) };
  }));
}

async function makePlan(segments: ApiSegment[], request: PlannerRequest, snapshot: OfflineSnapshot, graph: ConnectorGraph): Promise<ApiPlan> {
  const planKey: PlanKey = request.tripType === "economic" || request.tripType === "premium" ? request.tripType : "comfortable";
  const isArabic = request.language === "ar";
  const streetSegments = await snapConnectorSegments(segments, graph);
  const enrichedSegments = attachAlternatives(snapshot, streetSegments, planKey, isArabic);
  const cost = enrichedSegments.reduce((sum, s) => sum + s.cost_egp, 0);
  const time = enrichedSegments.reduce((sum, s) => sum + s.duration_minutes, 0);
  const distance = haversineKm({ lat: request.startLat, lng: request.startLng }, { lat: request.endLat, lng: request.endLng });
  return {
    segments: enrichedSegments,
    total_cost_egp: Math.round(cost),
    total_duration_minutes: Math.round(time),
    budget_range: { min: Math.max(0, Math.round(cost * 0.8)), max: Math.round(cost * 1.35 + 10) },
    distance_km: parseFloat(distance.toFixed(1)),
    offline: true,
    snapshot_revision: snapshot.revision,
  };
}

function openSnapshotDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SNAPSHOT_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(SNAPSHOT_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readCachedSnapshot(): Promise<{ snapshot: OfflineSnapshot; savedAt: number } | null> {
  if (!("indexedDB" in window)) return null;
  const db = await openSnapshotDb();
  return new Promise((resolve) => {
    const tx = db.transaction(SNAPSHOT_STORE, "readonly");
    const req = tx.objectStore(SNAPSHOT_STORE).get(SNAPSHOT_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
    tx.oncomplete = () => db.close();
  });
}

async function writeCachedSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  if (!("indexedDB" in window)) return;
  const db = await openSnapshotDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(SNAPSHOT_STORE, "readwrite");
    tx.objectStore(SNAPSHOT_STORE).put({ snapshot, savedAt: Date.now() }, SNAPSHOT_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
  });
}

function isUsableSnapshot(snapshot: OfflineSnapshot | null | undefined): snapshot is OfflineSnapshot {
  return Boolean(
    snapshot &&
    snapshot.schemaVersion >= MIN_COMPATIBLE_SNAPSHOT_SCHEMA_VERSION &&
    snapshot.schemaVersion <= SNAPSHOT_SCHEMA_VERSION &&
    snapshot.lines?.length &&
    snapshot.types?.length,
  );
}

function snapshotStamp(snapshot: OfflineSnapshot): number {
  const generated = Date.parse(snapshot.generatedAt);
  if (Number.isFinite(generated)) return generated;
  const revisionParts = String(snapshot.revision || "").split("-");
  const revisionStamp = Number(revisionParts[1]);
  return Number.isFinite(revisionStamp) ? revisionStamp : 0;
}

async function fetchSnapshot(): Promise<OfflineSnapshot | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), SNAPSHOT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/offline/snapshot`, { signal: controller.signal, cache: "no-cache" });
    if (!res.ok) return null;
    const snapshot = (await res.json()) as OfflineSnapshot;
    if (!isUsableSnapshot(snapshot)) return null;
    await writeCachedSnapshot(snapshot);
    return snapshot;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

function mergeSnapshotChanges(snapshot: OfflineSnapshot, changes: OfflineChanges): OfflineSnapshot {
  const typeMap = new Map(snapshot.types.map((type) => [type.id, type]));
  for (const type of changes.types ?? []) typeMap.set(type.id, type);

  const lineMap = new Map(snapshot.lines.map((line) => [line.id, line]));
  for (const line of changes.lines ?? []) {
    if (line.deleted) lineMap.delete(line.id);
    else if (line.path?.length >= 2) lineMap.set(line.id, line);
  }

  return {
    ...snapshot,
    schemaVersion: Math.max(snapshot.schemaVersion, changes.schemaVersion),
    generatedAt: changes.generatedAt,
    revision: changes.revision,
    types: [...typeMap.values()],
    lines: [...lineMap.values()],
  };
}

async function fetchSnapshotChanges(snapshot: OfflineSnapshot): Promise<OfflineSnapshot | null> {
  const since = snapshotStamp(snapshot);
  if (!since) return null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), SNAPSHOT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/offline/changes?since=${encodeURIComponent(String(since))}`, {
      signal: controller.signal,
      cache: "no-cache",
    });
    if (!res.ok) return null;
    const changes = (await res.json()) as OfflineChanges;
    if (!changes?.lines || snapshotStamp(changes as unknown as OfflineSnapshot) <= since) return null;
    const merged = mergeSnapshotChanges(snapshot, changes);
    if (!isUsableSnapshot(merged)) return null;
    await writeCachedSnapshot(merged);
    return merged;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchBundledSnapshot(): Promise<OfflineSnapshot | null> {
  try {
    const res = await fetch(BUNDLED_SNAPSHOT_URL, { cache: "force-cache" });
    if (!res.ok) return null;
    const snapshot = (await res.json()) as OfflineSnapshot;
    return isUsableSnapshot(snapshot) ? snapshot : null;
  } catch {
    return null;
  }
}

async function getSnapshot(): Promise<OfflineSnapshot | null> {
  const cached = await readCachedSnapshot().catch(() => null);
  if (cached && Date.now() - cached.savedAt <= SNAPSHOT_REFRESH_MS && isUsableSnapshot(cached.snapshot)) {
    void fetchSnapshotChanges(cached.snapshot);
    return cached.snapshot;
  }

  const bundled = await fetchBundledSnapshot();
  if (bundled) {
    const bestLocal = cached && isUsableSnapshot(cached.snapshot) && snapshotStamp(cached.snapshot) > snapshotStamp(bundled)
      ? cached.snapshot
      : bundled;
    void fetchSnapshot();
    if (cached?.snapshot) void fetchSnapshotChanges(bestLocal);
    void writeCachedSnapshot(bestLocal);
    return bestLocal;
  }

  const fresh = await fetchSnapshot();
  if (fresh) return fresh;
  return cached && isUsableSnapshot(cached.snapshot) ? cached.snapshot : null;
}

function buildCandidates(snapshot: OfflineSnapshot, point: Coord, planKey: PlanKey, limit: number): Candidate[] {
  const types = new Map(snapshot.types.map((t) => [t.id, t]));
  const allowed = allowedModes(planKey);
  const maxKm = planKey === "economic" ? 3.5 : 5;
  const candidates: Candidate[] = [];
  for (const line of snapshot.lines) {
    if (!line.path || line.path.length < 2) continue;
    const type = types.get(line.transportTypeId);
    if (!type) continue;
    const mode = modeOfType(type.nameEn);
    if (!allowed.has(mode)) continue;
    const closest = closestPointOnPath(line.path, point);
    if (closest.distanceKm <= maxKm) candidates.push({ line, type, mode, closest });
  }
  candidates.sort((a, b) => {
    const qa = routeQualityPenalty(a.line) + modePreferencePenalty(a.mode, planKey);
    const qb = routeQualityPenalty(b.line) + modePreferencePenalty(b.mode, planKey);
    return (a.closest.distanceKm * 18 + qa) - (b.closest.distanceKm * 18 + qb);
  });
  return candidates.slice(0, limit);
}

function bestTransfer(a: OfflineLine, b: OfflineLine, maxKm: number): { aPoint: ClosestPoint; bPoint: ClosestPoint; km: number } | null {
  let best: { aPoint: ClosestPoint; bPoint: ClosestPoint; km: number } | null = null;
  const aSamples = samplePath(a.path);
  const bSamples = samplePath(b.path);
  for (const ap of aSamples) {
    const ac = { lng: ap.point[0], lat: ap.point[1] };
    for (const bp of bSamples) {
      const bc = { lng: bp.point[0], lat: bp.point[1] };
      const km = haversineKm(ac, bc);
      if (km <= maxKm && (!best || km < best.km)) {
        best = {
          km,
          aPoint: { coord: ac, index: ap.index, distanceKm: 0 },
          bPoint: { coord: bc, index: bp.index, distanceKm: 0 },
        };
      }
    }
  }
  return best;
}

export async function planTripOnDevice(request: PlannerRequest): Promise<ApiPlan | null> {
  if (request.mode && request.mode === "intercity") return null;
  const planKey: PlanKey = request.tripType === "economic" || request.tripType === "premium" ? request.tripType : "comfortable";
  const isArabic = request.language === "ar";
  const [snapshot, roadGraph] = await Promise.all([getSnapshot(), getRoadConnectorGraph()]);
  if (!snapshot) {
    throw new OfflineRouteError("offline_data_missing", "Offline route data is not available on this device yet.");
  }
  const connectorGraph = roadGraph ?? buildConnectorGraph(snapshot);

  const origin = { lat: request.startLat, lng: request.startLng };
  const dest = { lat: request.endLat, lng: request.endLng };
  const directKm = haversineKm(origin, dest);

  if (directKm <= WALK_MAX_KM) {
    const walk = connectorFor(directKm, origin, dest, planKey);
    if (walk) return makePlan([connectorSegment(walk, isArabic ? "موقعك" : "Your location", request.destination || (isArabic ? "الوجهة" : "Destination"), isArabic)], request, snapshot, connectorGraph);
  }

  if (planKey === "premium" && directKm <= 18) {
    return makePlan([connectorSegment(directTaxiConnector(directKm, origin, dest), isArabic ? "موقعك" : "Your location", request.destination || (isArabic ? "الوجهة" : "Destination"), isArabic)], request, snapshot, connectorGraph);
  }

  const startCandidates = buildCandidates(snapshot, origin, planKey, 36);
  const endCandidates = buildCandidates(snapshot, dest, planKey, 36);
  if (!startCandidates.length && !endCandidates.length) {
    throw new OfflineRouteError("no_nearby_route_data", "No saved route geometry is near the start or destination.");
  }
  if (!startCandidates.length) {
    throw new OfflineRouteError("no_boarding_route_near_start", "No saved route geometry is close enough to the start point.");
  }
  if (!endCandidates.length) {
    throw new OfflineRouteError("no_route_near_destination", "No saved route geometry reaches close enough to the destination.");
  }
  let best: { score: number; segments: ApiSegment[] } | null = null;

  for (const start of startCandidates) {
    for (const end of endCandidates) {
      if (start.line.id !== end.line.id) continue;
      const access = connectorFor(start.closest.distanceKm, origin, start.closest.coord, planKey);
      const egress = connectorFor(end.closest.distanceKm, end.closest.coord, dest, planKey);
      if (!access || !egress) continue;
      const ride = rideSegment(start, start.closest, end.closest, isArabic);
      const segments = [
        connectorSegment(access, isArabic ? "موقعك" : "Your location", ride.start_name, isArabic),
        ride,
        connectorSegment(egress, ride.end_name, request.destination || (isArabic ? "الوجهة" : "Destination"), isArabic),
      ];
      const score = scoreSegments(segments, planKey)
        + routeQualityPenalty(start.line)
        + modePreferencePenalty(start.mode, planKey);
      if (!best || score < best.score) best = { score, segments };
    }
  }

  for (const start of startCandidates.slice(0, 24)) {
    for (const end of endCandidates.slice(0, 24)) {
      if (start.line.id === end.line.id) continue;
      const transfer = bestTransfer(start.line, end.line, 0.7);
      if (!transfer) continue;
      const access = connectorFor(start.closest.distanceKm, origin, start.closest.coord, planKey);
      const egress = connectorFor(end.closest.distanceKm, end.closest.coord, dest, planKey);
      const transferWalk = connectorFor(transfer.km, transfer.aPoint.coord, transfer.bPoint.coord, planKey);
      if (!access || !egress || !transferWalk || transferWalk.mode !== "walk") continue;
      const rideA = rideSegment(start, start.closest, transfer.aPoint, isArabic);
      const rideB = rideSegment(end, transfer.bPoint, end.closest, isArabic);
      const segments = [
        connectorSegment(access, isArabic ? "موقعك" : "Your location", rideA.start_name, isArabic),
        rideA,
        connectorSegment(transferWalk, rideA.end_name, rideB.start_name, isArabic),
        rideB,
        connectorSegment(egress, rideB.end_name, request.destination || (isArabic ? "الوجهة" : "Destination"), isArabic),
      ];
      const score = scoreSegments(segments, planKey)
        + routeQualityPenalty(start.line)
        + routeQualityPenalty(end.line)
        + modePreferencePenalty(start.mode, planKey)
        + modePreferencePenalty(end.mode, planKey);
      if (!best || score < best.score) best = { score, segments };
    }
  }

  if (!best) {
    throw new OfflineRouteError("no_connected_route", "Saved route geometries exist nearby, but no connected trip was found between them.");
  }
  return makePlan(best.segments, request, snapshot, connectorGraph);
}
