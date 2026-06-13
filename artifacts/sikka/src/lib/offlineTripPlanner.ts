// On-device trip-planning brain.
//
// All rider trip generation, scoring, validation, alternatives and route-card
// selection happen locally on the device from a synced route snapshot — the
// backend planner is only kept for admin/debug parity. The engine mirrors the
// server graph planner: it builds a deterministic boarding-point graph from the
// IndexedDB snapshot, runs a Pareto/Dijkstra label-setting search, enforces
// walking caps + transfer/geometry validation + taxi restrictions, and emits up
// to four labeled route cards (Recommended / Cheapest / Fastest / Fewest
// transfers). It NEVER invents a route — every ride leg is backed by a verified
// line from the snapshot.

type LngLat = [number, number];
type Coord = { lat: number; lng: number };
type PlanKey = "economic" | "comfortable" | "premium";
type ModeKey = "metro" | "monorail" | "train" | "bus" | "serfis" | "microbus" | "taxi" | "tuktuk" | "walk";
type CardKey = "recommended" | "cheapest" | "fastest" | "fewest";

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
  priceEgp: number;
  frequencyMinutes: number | null;
  hasFixedStops: boolean;
  // Route-quality metadata (v3 snapshot). Older snapshots omit these and the
  // engine derives sane defaults.
  dataSource?: "discovery" | "gtfs" | "admin" | "csv" | "seed";
  sourcePriority?: number;
  confidenceScore?: number;
  routeStatus?: "active" | "needs_review" | "inactive" | "pending_discovery";
  pathSuspect?: boolean;
  verifiedAt?: string | null;
  lastConfirmedAt?: string | null;
  reviewReportCount?: number;
  qualityAgeDays?: number;
  revision?: number;
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
  route_status?: "active" | "needs_review" | "inactive" | "pending_discovery" | null;
  data_source?: string | null;
  alternatives: ApiAlternative[];
};

type RouteCardLabel = { key: CardKey; en: string; ar: string; color: string };

type ApiPlan = {
  segments: ApiSegment[];
  total_cost_egp: number;
  total_duration_minutes: number;
  budget_range: { min: number; max: number };
  distance_km: number;
  offline?: boolean;
  snapshot_revision?: string;
  card?: RouteCardLabel;
  total_walk_km?: number;
  transfers?: number;
  quality_score?: number;
  needs_review?: boolean;
};

const DEFAULT_API_ORIGIN = "https://sikka-mq6w.onrender.com";
const API_ORIGIN = ((import.meta.env.VITE_API_URL as string | undefined) || DEFAULT_API_ORIGIN).replace(/\/+$/, "");
const API_BASE = `${API_ORIGIN}/api`;
const SNAPSHOT_DB = "sikka-offline";
const SNAPSHOT_STORE = "snapshots";
const SNAPSHOT_KEY = "latest";
const SNAPSHOT_SCHEMA_VERSION = 3;
const SNAPSHOT_REFRESH_MS = 10 * 60 * 1000;

// ── Tunables (mirror the backend engine) ───────────────────────────────────
const WALK_MAX_KM = 0.8; // longest single walk leg
const WALK_MAX_TOTAL_KM = 1.6; // total walking budget across the whole trip
const WALK_SPEED_KMH = 4.5;
const WALK_DETOUR = 1.3; // street circuity factor
const TUKTUK_CONNECT_KM = 3;
const TAXI_CONNECT_KM = 5;
const PREMIUM_DIRECT_TAXI_KM = 18;
const DENSE_SPACING_KM = 1.0; // board-anywhere sampling
const MAX_POINTS_PER_LINE = 60;
const WALK_TRANSFER_KM = 0.4; // max walk to transfer between two lines
const MAX_TRANSFER_LINKS = 8; // per boarding point
const CORRIDOR_EXPAND_KM = 4; // bbox margin for corridor line selection
const MAX_CORRIDOR_LINES = 140;
const BOARDING_PENALTY_MIN = 7;
const ALIGHT_PENALTY_MIN = 2;
const FARE_MARKUP = 1.25;
const MAX_DETOUR_RATIO = 2.4; // reject plans wandering far past straight distance
const MAX_TRANSFERS = 3;

const streetGeometryCache = new Map<string, LngLat[] | null>();

// ── geo helpers ─────────────────────────────────────────────────────────────
function haversineKm(a: Coord, b: Coord): number {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function pathLengthKm(path: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineKm({ lng: path[i - 1][0], lat: path[i - 1][1] }, { lng: path[i][0], lat: path[i][1] });
  return total;
}

function maxConsecutiveStepKm(path: LngLat[]): number {
  let max = 0;
  for (let i = 1; i < path.length; i++) {
    max = Math.max(max, haversineKm({ lng: path[i - 1][0], lat: path[i - 1][1] }, { lng: path[i][0], lat: path[i][1] }));
  }
  return max;
}

function slicePath(path: LngLat[], fromIdx: number, toIdx: number): LngLat[] {
  const a = Math.max(0, Math.min(fromIdx, path.length - 1));
  const b = Math.max(0, Math.min(toIdx, path.length - 1));
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const sliced = path.slice(lo, hi + 1);
  const oriented = a <= b ? sliced : sliced.slice().reverse();
  return oriented.length >= 2 ? oriented : [path[a], path[b]];
}

function walkMinutes(km: number): number {
  return ((km * WALK_DETOUR) / WALK_SPEED_KMH) * 60;
}

function modeOfType(nameEn: string): ModeKey {
  const n = nameEn.toLowerCase();
  if (n.includes("metro")) return "metro";
  if (n.includes("monorail")) return "monorail";
  if (n.includes("train")) return "train";
  if (n.includes("serfis")) return "serfis";
  if (n.includes("microbus")) return "microbus";
  if (n.includes("tuktuk") || n.includes("toktok")) return "tuktuk";
  if (n.includes("taxi") || n.includes("uber") || n.includes("careem") || n.includes("car")) return "taxi";
  if (n.includes("bus")) return "bus";
  return "bus";
}

function allowedModes(planKey: PlanKey): Set<ModeKey> {
  if (planKey === "economic") return new Set(["metro", "monorail", "train", "bus", "serfis", "microbus", "tuktuk"]);
  return new Set(["metro", "monorail", "train", "bus", "serfis", "taxi", "tuktuk"]);
}

// ── route-quality scoring (mirrors backend lib/routeQuality) ────────────────
function dataSourceOf(line: OfflineLine): OfflineLine["dataSource"] {
  if (line.dataSource) return line.dataSource;
  if (line.hasFixedStops || (line.pathPointCount ?? line.path.length) >= 50) return "gtfs";
  return "seed";
}

function sourcePriorityOf(line: OfflineLine): number {
  if (typeof line.sourcePriority === "number") return line.sourcePriority;
  const src = dataSourceOf(line);
  return src === "discovery" ? 4 : src === "gtfs" ? 3 : src === "admin" ? 2 : 1;
}

function isSuspect(line: OfflineLine): boolean {
  if (typeof line.pathSuspect === "boolean") return line.pathSuspect;
  return maxConsecutiveStepKm(line.path) > 0.5;
}

// Trust penalty added to a plan's score weight (lower weight = better plan).
// Higher-priority sources get a discount; needs_review / suspect geometry / old
// verification / missing line number all add cost.
function lineTrustPenalty(line: OfflineLine): number {
  let penalty = 0;
  const priority = sourcePriorityOf(line);
  // Discovery (4) → -36, GTFS (3) → -24, Admin (2) → -12, CSV/Seed (1) → 0.
  penalty -= (priority - 1) * 12;
  if (line.routeStatus === "needs_review") penalty += 60;
  if (isSuspect(line)) penalty += 45;
  if (!line.lineNumber) penalty += 8;
  const reports = line.reviewReportCount ?? 0;
  penalty += Math.min(40, reports * 8);
  const ageDays = line.qualityAgeDays;
  if (typeof ageDays === "number" && ageDays >= 0) {
    if (ageDays > 365) penalty += 25;
    else if (ageDays > 180) penalty += 12;
  }
  return penalty;
}

function modePreferencePenalty(mode: ModeKey, planKey: PlanKey): number {
  if (planKey === "economic") {
    if (mode === "metro" || mode === "train" || mode === "bus") return -12;
    if (mode === "taxi") return 200;
    return 0;
  }
  if (planKey === "comfortable") {
    if (mode === "metro" || mode === "train" || mode === "bus") return -18;
    if (mode === "microbus") return 85;
    if (mode === "taxi" || mode === "tuktuk") return 18;
    return 0;
  }
  if (mode === "taxi") return -20;
  if (mode === "metro" || mode === "train") return -10;
  if (mode === "microbus") return 120;
  return 0;
}

// ── street snapping for connector legs ──────────────────────────────────────
async function fetchStreetGeometry(mode: ModeKey, from: LngLat, to: LngLat, signal: AbortSignal): Promise<LngLat[] | null> {
  const drivingUrls = [
    `https://router.project-osrm.org/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=false`,
    `https://routing.openstreetmap.de/routed-car/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=false`,
  ];
  const walkingUrls = [
    `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=false`,
    `https://router.project-osrm.org/route/v1/foot/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=false`,
    `https://router.project-osrm.org/route/v1/walking/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=false`,
  ];
  const urls = mode === "walk" ? walkingUrls : drivingUrls;
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal, cache: "force-cache" });
      if (!res.ok) continue;
      const data = await res.json();
      const coords = data.routes?.[0]?.geometry?.coordinates as LngLat[] | undefined;
      if (Array.isArray(coords) && coords.length >= 2) return coords.map((p) => [p[0], p[1]] as LngLat);
    } catch {
      if (signal.aborted) return null;
    }
  }
  return null;
}

// Snap a connector (walk/taxi/tuktuk) to the real street/pedestrian network.
// Walk legs are snapped to pedestrian routing; if snapping fails we only keep
// the straight line when it is very short and plausibly on-street — otherwise we
// signal failure so the caller can reject the diagonal/off-street geometry.
async function snapConnectorGeometry(
  mode: ModeKey,
  geometry: LngLat[],
): Promise<{ geometry: LngLat[]; snapped: boolean }> {
  if (geometry.length < 2) return { geometry, snapped: false };
  if (mode !== "walk" && mode !== "taxi" && mode !== "tuktuk") return { geometry, snapped: true };
  const from = geometry[0];
  const to = geometry[geometry.length - 1];
  const profile = mode === "walk" ? "foot" : "driving";
  const key = `${profile}:${from[0].toFixed(5)},${from[1].toFixed(5)}:${to[0].toFixed(5)},${to[1].toFixed(5)}`;
  if (streetGeometryCache.has(key)) {
    const cached = streetGeometryCache.get(key);
    return cached ? { geometry: cached, snapped: true } : { geometry, snapped: false };
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 5000);
  try {
    const snapped = await fetchStreetGeometry(mode, from, to, controller.signal);
    if (snapped?.length) {
      snapped[0] = from;
      snapped[snapped.length - 1] = to;
      streetGeometryCache.set(key, snapped);
      return { geometry: snapped, snapped: true };
    }
  } finally {
    window.clearTimeout(timer);
  }
  streetGeometryCache.set(key, null);
  return { geometry, snapped: false };
}

// ── graph model ─────────────────────────────────────────────────────────────
type GEdge = {
  to: string;
  kind: "ride" | "board" | "alight" | "walk" | "tuktuk" | "taxi";
  timeMin: number;
  costEgp: number;
  walkKm: number; // walking distance contained (for caps); 0 for vehicles
  isBoarding: boolean; // board edges only (counts as a boarding/transfer)
  mode: ModeKey;
  lineRef?: number; // index into corridor lines
  fromIndex?: number;
  toIndex?: number;
};

type CorridorLine = {
  line: OfflineLine;
  type: OfflineType;
  mode: ModeKey;
  points: { coord: Coord; pathIndex: number }[];
};

type DeviceGraph = {
  lines: CorridorLine[];
  nodes: Map<string, Coord>;
  edges: Map<string, GEdge[]>;
};

function bboxIntersects(a: number[], b: number[], marginDeg: number): boolean {
  return (
    a[0] - marginDeg <= b[2] &&
    a[2] + marginDeg >= b[0] &&
    a[1] - marginDeg <= b[3] &&
    a[3] + marginDeg >= b[1]
  );
}

function lineBbox(path: LngLat[]): number[] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of path) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

function densifyPoints(path: LngLat[]): { coord: Coord; pathIndex: number }[] {
  const pts: { coord: Coord; pathIndex: number }[] = [];
  let acc = Infinity; // force the first point
  let prev: Coord | null = null;
  for (let i = 0; i < path.length; i++) {
    const coord = { lng: path[i][0], lat: path[i][1] };
    if (prev) acc += haversineKm(prev, coord);
    if (acc >= DENSE_SPACING_KM || i === 0 || i === path.length - 1) {
      pts.push({ coord, pathIndex: i });
      acc = 0;
    }
    prev = coord;
  }
  if (pts.length <= MAX_POINTS_PER_LINE) return pts;
  // Down-sample uniformly while keeping endpoints.
  const step = Math.ceil(pts.length / MAX_POINTS_PER_LINE);
  const out = pts.filter((_, idx) => idx % step === 0);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

function lineFareBoarding(type: OfflineType, line: OfflineLine): number {
  const base = type.pricePerKmEgp > 0 ? type.basePriceEgp : line.priceEgp || type.basePriceEgp || 5;
  return Math.round(base * FARE_MARKUP);
}

function ridePerKm(type: OfflineType): number {
  return type.pricePerKmEgp * FARE_MARKUP;
}

function waitMinutes(line: OfflineLine, mode: ModeKey): number {
  const defaults: Record<ModeKey, number> = { metro: 6, monorail: 8, train: 30, bus: 18, serfis: 10, microbus: 10, taxi: 6, tuktuk: 5, walk: 0 };
  return Math.max(0, (line.frequencyMinutes ?? defaults[mode]) / 2);
}

function cellKey(c: Coord): string {
  return `${Math.floor(c.lat / 0.01)}:${Math.floor(c.lng / 0.01)}`;
}

function buildGraph(snapshot: OfflineSnapshot, origin: Coord, dest: Coord, planKey: PlanKey): DeviceGraph {
  const typeById = new Map(snapshot.types.map((t) => [t.id, t]));
  const allowed = allowedModes(planKey);
  const corridor = [Math.min(origin.lng, dest.lng), Math.min(origin.lat, dest.lat), Math.max(origin.lng, dest.lng), Math.max(origin.lat, dest.lat)];
  const marginDeg = CORRIDOR_EXPAND_KM / 111;

  // Select corridor lines: bbox intersects the origin→dest corridor, or the line
  // passes within access range of either endpoint.
  const selected: { cl: CorridorLine; proximity: number }[] = [];
  for (const line of snapshot.lines) {
    if (!line.path || line.path.length < 2) continue;
    if (line.routeStatus === "inactive" || line.routeStatus === "pending_discovery") continue;
    const type = typeById.get(line.transportTypeId);
    if (!type) continue;
    const mode = modeOfType(type.nameEn);
    if (!allowed.has(mode)) continue;
    const bbox = lineBbox(line.path);
    if (!bboxIntersects(bbox, corridor, marginDeg)) continue;
    const points = densifyPoints(line.path);
    let nearOrigin = Infinity;
    let nearDest = Infinity;
    for (const p of points) {
      nearOrigin = Math.min(nearOrigin, haversineKm(p.coord, origin));
      nearDest = Math.min(nearDest, haversineKm(p.coord, dest));
    }
    selected.push({ cl: { line, type, mode, points }, proximity: Math.min(nearOrigin, nearDest) });
  }
  selected.sort((a, b) => a.proximity - b.proximity);
  const lines = selected.slice(0, MAX_CORRIDOR_LINES).map((s) => s.cl);

  const nodes = new Map<string, Coord>();
  const edges = new Map<string, GEdge[]>();
  const push = (from: string, e: GEdge) => {
    const arr = edges.get(from);
    if (arr) arr.push(e);
    else edges.set(from, [e]);
  };

  nodes.set("origin", origin);
  nodes.set("dest", dest);

  // Street + onboard nodes per line, ride/board/alight edges.
  const grid = new Map<string, { id: string; coord: Coord; lineRef: number }[]>();
  for (let li = 0; li < lines.length; li++) {
    const cl = lines[li];
    const boardFare = lineFareBoarding(cl.type, cl.line);
    const perKm = ridePerKm(cl.type);
    const speed = Math.max(cl.type.averageSpeedKmh || 25, 8);
    const wait = waitMinutes(cl.line, cl.mode);
    for (let pi = 0; pi < cl.points.length; pi++) {
      const sId = `s:${li}:${pi}`;
      const oId = `o:${li}:${pi}`;
      const coord = cl.points[pi].coord;
      nodes.set(sId, coord);
      nodes.set(oId, coord);
      // board: pay fare + wait to get on the vehicle.
      push(sId, { to: oId, kind: "board", timeMin: wait + BOARDING_PENALTY_MIN, costEgp: boardFare, walkKm: 0, isBoarding: true, mode: cl.mode, lineRef: li, fromIndex: cl.points[pi].pathIndex });
      // alight: small friction to step off.
      push(oId, { to: sId, kind: "alight", timeMin: ALIGHT_PENALTY_MIN, costEgp: 0, walkKm: 0, isBoarding: false, mode: cl.mode, lineRef: li });
      const bucket = grid.get(cellKey(coord));
      if (bucket) bucket.push({ id: sId, coord, lineRef: li });
      else grid.set(cellKey(coord), [{ id: sId, coord, lineRef: li }]);
    }
    // ride edges between consecutive boarding points (both directions).
    for (let pi = 0; pi < cl.points.length - 1; pi++) {
      const a = cl.points[pi];
      const b = cl.points[pi + 1];
      const km = haversineKm(a.coord, b.coord);
      const timeMin = (km / speed) * 60;
      const cost = Math.round(perKm * km);
      push(`o:${li}:${pi}`, { to: `o:${li}:${pi + 1}`, kind: "ride", timeMin, costEgp: cost, walkKm: 0, isBoarding: false, mode: cl.mode, lineRef: li, fromIndex: a.pathIndex, toIndex: b.pathIndex });
      push(`o:${li}:${pi + 1}`, { to: `o:${li}:${pi}`, kind: "ride", timeMin, costEgp: cost, walkKm: 0, isBoarding: false, mode: cl.mode, lineRef: li, fromIndex: b.pathIndex, toIndex: a.pathIndex });
    }
  }

  // Transfer walk edges between street nodes of DIFFERENT lines that are close.
  for (const [, bucket] of grid) {
    for (const node of bucket) {
      const near: { id: string; km: number }[] = [];
      const c = node.coord;
      const base = `${Math.floor(c.lat / 0.01)}`;
      void base;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const key = `${Math.floor(c.lat / 0.01) + dy}:${Math.floor(c.lng / 0.01) + dx}`;
          const arr = grid.get(key);
          if (!arr) continue;
          for (const other of arr) {
            if (other.lineRef === node.lineRef) continue;
            const km = haversineKm(c, other.coord);
            if (km <= WALK_TRANSFER_KM) near.push({ id: other.id, km });
          }
        }
      }
      near.sort((a, b) => a.km - b.km);
      for (const n of near.slice(0, MAX_TRANSFER_LINKS)) {
        push(node.id, { to: n.id, kind: "walk", timeMin: walkMinutes(n.km), costEgp: 0, walkKm: n.km, isBoarding: false, mode: "walk", lineRef: node.lineRef });
      }
    }
  }

  // Access (origin→street) and egress (street→dest) connectors.
  const connect = (fromId: string, toId: string, distKm: number, c: Coord) => {
    if (distKm <= WALK_MAX_KM) {
      push(fromId, { to: toId, kind: "walk", timeMin: walkMinutes(distKm), costEgp: 0, walkKm: distKm, isBoarding: false, mode: "walk" });
      return;
    }
    if (planKey === "economic" && distKm <= TUKTUK_CONNECT_KM) {
      push(fromId, { to: toId, kind: "tuktuk", timeMin: (distKm / 22) * 60, costEgp: Math.round(8 + distKm * 7), walkKm: 0, isBoarding: false, mode: "tuktuk" });
    }
    if (planKey !== "economic" && distKm <= TAXI_CONNECT_KM) {
      push(fromId, { to: toId, kind: "taxi", timeMin: (distKm / 28) * 60, costEgp: Math.round(15 + distKm * 5), walkKm: 0, isBoarding: false, mode: "taxi" });
    }
    void c;
  };

  for (let li = 0; li < lines.length; li++) {
    const cl = lines[li];
    for (let pi = 0; pi < cl.points.length; pi++) {
      const c = cl.points[pi].coord;
      const dO = haversineKm(origin, c);
      const dD = haversineKm(c, dest);
      if (dO <= TAXI_CONNECT_KM) connect("origin", `s:${li}:${pi}`, dO, c);
      if (dD <= TAXI_CONNECT_KM) connect(`s:${li}:${pi}`, "dest", dD, c);
    }
  }

  // Direct walk if very close; direct taxi only for premium.
  const direct = haversineKm(origin, dest);
  if (direct <= WALK_MAX_KM) {
    push("origin", { to: "dest", kind: "walk", timeMin: walkMinutes(direct), costEgp: 0, walkKm: direct, isBoarding: false, mode: "walk" });
  }
  if (planKey === "premium" && direct <= PREMIUM_DIRECT_TAXI_KM) {
    push("origin", { to: "dest", kind: "taxi", timeMin: (direct / 32) * 60, costEgp: Math.round(18 + direct * 6), walkKm: 0, isBoarding: false, mode: "taxi" });
  }

  return { lines, nodes, edges };
}

// ── Pareto label-setting search ─────────────────────────────────────────────
type CardProfile = {
  key: CardKey;
  timeW: number;
  costW: number;
  walkW: number; // extra per walking km
  transferW: number; // per boarding beyond the first
  avoidTaxi: boolean; // strongly penalize taxi legs
  modePrefScale: number; // how strongly to apply per-mode preference
};

function cardProfiles(planKey: PlanKey): CardProfile[] {
  // Recommended + Cheapest avoid taxi and strongly prefer fewer transports.
  // Fastest optimizes time (taxi allowed where the tier permits). Fewest
  // transfers minimizes boardings.
  const base: CardProfile[] = [
    { key: "recommended", timeW: 1.0, costW: 1.1, walkW: 6, transferW: 14, avoidTaxi: true, modePrefScale: 1 },
    { key: "cheapest", timeW: 0.45, costW: 3.0, walkW: 5, transferW: 16, avoidTaxi: true, modePrefScale: 1 },
    { key: "fastest", timeW: 2.4, costW: 0.4, walkW: 7, transferW: 8, avoidTaxi: planKey === "economic", modePrefScale: 0.6 },
    { key: "fewest", timeW: 1.1, costW: 0.9, walkW: 6, transferW: 34, avoidTaxi: planKey !== "premium", modePrefScale: 1 },
  ];
  return base;
}

function edgeWeight(e: GEdge, profile: CardProfile, planKey: PlanKey, graph: DeviceGraph): number {
  let w = profile.timeW * e.timeMin + profile.costW * e.costEgp + profile.walkW * e.walkKm;
  if (e.isBoarding) {
    w += profile.transferW;
    const modePref = modePreferencePenalty(e.mode, planKey) * profile.modePrefScale;
    w += modePref;
    if (e.lineRef != null) w += lineTrustPenalty(graph.lines[e.lineRef].line);
  }
  if ((e.mode === "taxi" || e.mode === "tuktuk")) {
    // Connector ride: penalize, very strongly when this card avoids taxi.
    if (e.mode === "taxi") w += profile.avoidTaxi ? 400 : 40;
    else w += 25;
  }
  return Math.max(0, w);
}

type SLabel = {
  node: string;
  weight: number;
  totalWalkKm: number;
  contWalkKm: number;
  prev: SLabel | null;
  edge: GEdge | null;
  alive: boolean;
};

class MinHeap {
  private items: { p: number; v: SLabel }[] = [];
  get size() { return this.items.length; }
  push(p: number, v: SLabel) {
    const a = this.items;
    a.push({ p, v });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].p <= a[i].p) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop(): SLabel | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let s = i;
        if (l < a.length && a[l].p < a[s].p) s = l;
        if (r < a.length && a[r].p < a[s].p) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top.v;
  }
}

function search(graph: DeviceGraph, profile: CardProfile, planKey: PlanKey, maxResults = 6): SLabel[] {
  const labelsByNode = new Map<string, SLabel[]>();
  const heap = new MinHeap();
  const maxSingleWalkKm = WALK_MAX_KM + 0.05;
  const maxTotalWalkKm = WALK_MAX_TOTAL_KM + 0.05;

  const add = (node: string, weight: number, totalWalk: number, contWalk: number, prev: SLabel | null, edge: GEdge | null) => {
    if (contWalk > maxSingleWalkKm || totalWalk > maxTotalWalkKm) return;
    const existing = labelsByNode.get(node);
    if (existing) {
      for (const l of existing) if (l.alive && l.weight <= weight && l.totalWalkKm <= totalWalk && l.contWalkKm <= contWalk) return;
      for (const l of existing) if (l.alive && l.weight >= weight && l.totalWalkKm >= totalWalk && l.contWalkKm >= contWalk) l.alive = false;
    }
    const lab: SLabel = { node, weight, totalWalkKm: totalWalk, contWalkKm: contWalk, prev, edge, alive: true };
    if (existing) existing.push(lab);
    else labelsByNode.set(node, [lab]);
    heap.push(weight, lab);
  };

  add("origin", 0, 0, 0, null, null);
  const goals: SLabel[] = [];
  let pops = 0;
  while (heap.size > 0) {
    const lab = heap.pop()!;
    if (!lab.alive) continue;
    if (++pops > 200000) break;
    if (lab.node === "dest") {
      goals.push(lab);
      if (goals.reduce((n, l) => n + (l.alive ? 1 : 0), 0) >= maxResults) break;
      continue;
    }
    const adj = graph.edges.get(lab.node);
    if (!adj) continue;
    for (const e of adj) {
      const w = lab.weight + edgeWeight(e, profile, planKey, graph);
      const total = lab.totalWalkKm + e.walkKm;
      // Continuous walk resets the moment the rider boards / rides a vehicle.
      const cont = e.walkKm > 0 ? lab.contWalkKm + e.walkKm : 0;
      add(e.to, w, total, cont, lab, e);
    }
  }
  return goals;
}

// ── reconstruction + validation ─────────────────────────────────────────────
type RawLeg =
  | { kind: "connector"; mode: ModeKey; from: Coord; to: Coord; timeMin: number; costEgp: number; distanceKm: number }
  | { kind: "ride"; lineRef: number; fromIndex: number; toIndex: number; timeMin: number; costEgp: number; waitBoardMin: number };

function reconstruct(label: SLabel): GEdge[] {
  const edges: GEdge[] = [];
  let cur: SLabel | null = label;
  while (cur && cur.edge) {
    edges.push(cur.edge);
    cur = cur.prev;
  }
  return edges.reverse();
}

function nodeCoordOf(graph: DeviceGraph, id: string): Coord {
  return graph.nodes.get(id)!;
}

function toRawLegs(graph: DeviceGraph, label: SLabel): RawLeg[] | null {
  const edges = reconstruct(label);
  if (!edges.length) return null;
  const ids: string[] = ["origin"];
  for (const e of edges) ids.push(e.to);

  const legs: RawLeg[] = [];
  let i = 0;
  while (i < edges.length) {
    const e = edges[i];
    if (e.kind === "walk" || e.kind === "taxi" || e.kind === "tuktuk") {
      // Merge a run of consecutive connector edges of the same mode.
      let j = i;
      let time = 0, cost = 0, dist = 0;
      const startCoord = nodeCoordOf(graph, ids[i]);
      while (j < edges.length && (edges[j].kind === "walk" || edges[j].kind === "taxi" || edges[j].kind === "tuktuk") && edges[j].mode === e.mode) {
        time += edges[j].timeMin;
        cost += edges[j].costEgp;
        dist += edges[j].walkKm > 0 ? edges[j].walkKm : haversineKm(nodeCoordOf(graph, ids[j]), nodeCoordOf(graph, ids[j + 1]));
        j++;
      }
      const endCoord = nodeCoordOf(graph, ids[j]);
      legs.push({ kind: "connector", mode: e.mode, from: startCoord, to: endCoord, timeMin: time, costEgp: cost, distanceKm: dist || haversineKm(startCoord, endCoord) });
      i = j;
      continue;
    }
    if (e.kind === "board") {
      const lineRef = e.lineRef!;
      const waitBoard = e.timeMin;
      const boardFare = e.costEgp;
      const fromIndex = e.fromIndex!;
      i++;
      let time = 0, cost = 0, toIndex = fromIndex;
      while (i < edges.length && edges[i].kind === "ride") {
        time += edges[i].timeMin;
        cost += edges[i].costEgp;
        toIndex = edges[i].toIndex!;
        i++;
      }
      if (i < edges.length && edges[i].kind === "alight") i++;
      if (time === 0) {
        // boarded but never rode — skip this degenerate boarding.
        continue;
      }
      legs.push({ kind: "ride", lineRef, fromIndex, toIndex, timeMin: time + waitBoard, costEgp: cost + boardFare, waitBoardMin: waitBoard });
      continue;
    }
    // stray alight or board with no ride
    i++;
  }
  return legs.length ? legs : null;
}

// ── segment building ────────────────────────────────────────────────────────
function transportName(type: OfflineType, line: OfflineLine, isArabic: boolean): string {
  const lineName = isArabic ? line.nameAr : line.nameEn;
  const typeName = isArabic ? type.nameAr : type.nameEn;
  return line.lineNumber ? `${typeName} ${line.lineNumber}` : lineName || typeName;
}

const CONNECTOR_LABEL: Record<"walk" | "taxi" | "tuktuk", { en: string; ar: string; color: string; icon: string }> = {
  walk: { en: "Walk", ar: "مشي", color: "#64748B", icon: "walk" },
  taxi: { en: "Taxi app", ar: "تطبيق تاكسي", color: "#111827", icon: "car" },
  tuktuk: { en: "Tuktuk", ar: "توك توك", color: "#F59E0B", icon: "tuktuk" },
};

function connectorSegment(mode: ModeKey, leg: Extract<RawLeg, { kind: "connector" }>, startName: string, endName: string, isArabic: boolean, geometry: LngLat[]): ApiSegment {
  const m = (mode === "walk" || mode === "taxi" || mode === "tuktuk") ? mode : "walk";
  const label = CONNECTOR_LABEL[m];
  const instructions = m === "walk"
    ? (isArabic ? [`امشِ ${leg.distanceKm.toFixed(1)} كم إلى ${endName}.`] : [`Walk ${leg.distanceKm.toFixed(1)} km to ${endName}.`])
    : (isArabic ? [`اطلب ${label.ar} إلى ${endName}.`] : [`Take a ${label.en} to ${endName}.`]);
  return {
    transport_type_id: m,
    transport_name: isArabic ? label.ar : label.en,
    government_type: "private",
    category: m === "walk" ? "economic" : "comfortable",
    start_name: startName,
    end_name: endName,
    cost_egp: Math.round(leg.costEgp),
    duration_minutes: Math.max(1, Math.round(leg.timeMin)),
    color: label.color,
    icon: label.icon,
    line_id: null,
    line_number: null,
    route_geometry: geometry,
    instructions,
    alternatives: [],
  };
}

function rideSegment(graph: DeviceGraph, leg: Extract<RawLeg, { kind: "ride" }>, isArabic: boolean): ApiSegment {
  const cl = graph.lines[leg.lineRef];
  const geometry = slicePath(cl.line.path, leg.fromIndex, leg.toIndex);
  const km = Math.max(0.2, pathLengthKm(geometry));
  const name = transportName(cl.type, cl.line, isArabic);
  const needsReview = cl.line.routeStatus === "needs_review";
  const dirHint = isArabic ? cl.line.toArea : cl.line.toArea;
  const instructions = isArabic
    ? [
        `اذهب إلى أقرب نقطة على ${name}.`,
        `اركب باتجاه ${dirHint} وانزل بعد حوالي ${km.toFixed(1)} كم.`,
        ...(cl.line.lineNumber ? [`ابحث عن رقم الخط ${cl.line.lineNumber}.`] : []),
        ...(needsReview ? ["هذا الخط قيد المراجعة — تأكد من السائق."] : []),
      ]
    : [
        `Go to the nearest point on ${name}.`,
        `Ride toward ${dirHint} and get off after about ${km.toFixed(1)} km.`,
        ...(cl.line.lineNumber ? [`Look for line number ${cl.line.lineNumber}.`] : []),
        ...(needsReview ? ["This line is under review — confirm with the driver."] : []),
      ];
  return {
    transport_type_id: cl.type.id,
    transport_name: name,
    government_type: cl.type.governmentType,
    category: cl.type.category,
    start_name: cl.line.fromArea,
    end_name: cl.line.toArea,
    cost_egp: Math.round(leg.costEgp),
    duration_minutes: Math.max(2, Math.round(leg.timeMin)),
    color: cl.type.color,
    icon: cl.type.icon || cl.mode,
    line_id: cl.line.id,
    line_number: cl.line.lineNumber,
    route_status: cl.line.routeStatus ?? "active",
    data_source: dataSourceOf(cl.line) ?? null,
    info: isArabic
      ? "محسوبة على هاتفك من بيانات Sikka المحفوظة."
      : "Computed on your phone from the synced Sikka route data.",
    instructions,
    route_geometry: geometry,
    alternatives: [],
  };
}

// Reject loops / impossible chains before we spend network calls snapping walks.
function rejectRawLegs(legs: RawLeg[], graph: DeviceGraph, directKm: number): boolean {
  const usedLines = new Set<string>();
  let transfers = -1;
  let totalWalkKm = 0;
  let pathKm = 0;
  for (const leg of legs) {
    if (leg.kind === "ride") {
      transfers++;
      const id = graph.lines[leg.lineRef].line.id;
      if (usedLines.has(id)) return true; // same line twice → loop
      usedLines.add(id);
      pathKm += pathLengthKm(slicePath(graph.lines[leg.lineRef].line.path, leg.fromIndex, leg.toIndex));
    } else {
      if (leg.mode === "walk") {
        totalWalkKm += leg.distanceKm;
        if (leg.distanceKm > WALK_MAX_KM + 0.05) return true;
      }
      pathKm += leg.distanceKm;
    }
  }
  if (transfers > MAX_TRANSFERS) return true;
  if (totalWalkKm > WALK_MAX_TOTAL_KM + 0.05) return true;
  if (directKm > 0.5 && pathKm > directKm * MAX_DETOUR_RATIO + 2) return true;
  return false;
}

async function buildSegments(graph: DeviceGraph, legs: RawLeg[], request: PlannerRequest, isArabic: boolean): Promise<ApiSegment[] | null> {
  const segments: ApiSegment[] = [];
  const originName = isArabic ? "موقعك" : "Your location";
  const destName = request.destination || (isArabic ? "الوجهة" : "Destination");

  for (let idx = 0; idx < legs.length; idx++) {
    const leg = legs[idx];
    if (leg.kind === "ride") {
      segments.push(rideSegment(graph, leg, isArabic));
      continue;
    }
    const startName = idx === 0 ? originName : segments[segments.length - 1]?.end_name || originName;
    const endName = idx === legs.length - 1 ? destName : "";
    const straight: LngLat[] = [[leg.from.lng, leg.from.lat], [leg.to.lng, leg.to.lat]];
    const { geometry, snapped } = await snapConnectorGeometry(leg.mode, straight);
    // Reject a bad straight-line walk unless it is very short and clearly valid.
    if (leg.mode === "walk" && !snapped && leg.distanceKm > 0.3) return null;
    const seg = connectorSegment(leg.mode, leg, startName, endName || (isArabic ? "الوجهة" : "Destination"), isArabic, geometry);
    segments.push(seg);
  }

  // Stitch start/end names across ride boundaries.
  for (let i = 1; i < segments.length; i++) {
    if (!segments[i].start_name) segments[i].start_name = segments[i - 1].end_name;
  }
  return segments;
}

function planScore(segments: ApiSegment[], graph: DeviceGraph, planKey: PlanKey, directKm: number): number {
  const totalCost = segments.reduce((s, seg) => s + seg.cost_egp, 0);
  const totalTime = segments.reduce((s, seg) => s + seg.duration_minutes, 0);
  const transfers = Math.max(0, segments.filter((s) => s.line_id).length - 1);
  const refTime = Math.max(15, directKm * 2.5);
  const refCost = Math.max(15, directKm * 4);
  const timeScore = clamp01(1 - (totalTime - refTime * 0.5) / (refTime * 1.5));
  const costScore = clamp01(1 - (totalCost - refCost * 0.2) / (refCost * 1.3));
  const transferScore = clamp01(1 - transfers / 4);
  const lineById = new Map(graph.lines.map((cl) => [cl.line.id, cl.line]));
  const trust = avg(segments.filter((s) => s.line_id).map((s) => {
    const l = lineById.get(s.line_id!);
    return l ? clamp01(l.confidenceScore ?? 0.6) : 0.6;
  }));
  const w = planKey === "economic"
    ? { t: 0.2, c: 0.4, x: 0.15, r: 0.25 }
    : planKey === "premium"
      ? { t: 0.45, c: 0.1, x: 0.2, r: 0.25 }
      : { t: 0.3, c: 0.25, x: 0.2, r: 0.25 };
  const score = w.t * timeScore + w.c * costScore + w.x * transferScore + w.r * trust;
  return Math.round(clamp01(score) * 100);
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
function avg(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0.6; }

const CARD_LABELS: Record<CardKey, RouteCardLabel> = {
  recommended: { key: "recommended", en: "Recommended", ar: "الموصى به", color: "#2563EB" },
  cheapest: { key: "cheapest", en: "Cheapest", ar: "الأرخص", color: "#16A34A" },
  fastest: { key: "fastest", en: "Fastest", ar: "الأسرع", color: "#DC2626" },
  fewest: { key: "fewest", en: "Fewest transfers", ar: "أقل تبديل", color: "#7C3AED" },
};

function planSignature(segments: ApiSegment[]): string {
  return segments.map((s) => s.line_id ?? s.transport_type_id).join(">");
}

function finalizePlan(segments: ApiSegment[], request: PlannerRequest, graph: DeviceGraph, snapshot: OfflineSnapshot, planKey: PlanKey, directKm: number, card: RouteCardLabel): ApiPlan {
  const cost = segments.reduce((s, seg) => s + seg.cost_egp, 0);
  const time = segments.reduce((s, seg) => s + seg.duration_minutes, 0);
  const transfers = Math.max(0, segments.filter((s) => s.line_id).length - 1);
  const totalWalkKm = segments.filter((s) => s.transport_type_id === "walk").reduce((s, seg) => s + (seg.duration_minutes * WALK_SPEED_KMH) / 60 / WALK_DETOUR, 0);
  const needsReview = segments.some((s) => s.route_status === "needs_review");
  return {
    segments,
    total_cost_egp: Math.round(cost),
    total_duration_minutes: Math.round(time),
    budget_range: { min: Math.max(0, Math.round(cost * 0.8)), max: Math.round(cost * 1.35 + 10) },
    distance_km: parseFloat(directKm.toFixed(1)),
    offline: true,
    snapshot_revision: snapshot.revision,
    card,
    total_walk_km: parseFloat(totalWalkKm.toFixed(2)),
    transfers,
    quality_score: planScore(segments, graph, planKey, directKm),
    needs_review: needsReview,
  };
}

// ── IndexedDB snapshot storage with delta sync ──────────────────────────────
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

async function fetchFullSnapshot(): Promise<OfflineSnapshot | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${API_BASE}/offline/snapshot`, { signal: controller.signal, cache: "no-cache" });
    if (!res.ok) return null;
    const snapshot = (await res.json()) as OfflineSnapshot;
    if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || !snapshot.lines?.length) return null;
    await writeCachedSnapshot(snapshot);
    return snapshot;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

type DeltaResponse = {
  schemaVersion: number;
  revision: string;
  full: boolean;
  types: OfflineType[];
  changedLines: OfflineLine[];
  removedLineIds: string[];
};

// Apply a delta against the cached snapshot by revision. Falls back to a full
// snapshot when the schema changed or there is no usable cache.
async function syncSnapshot(cached: OfflineSnapshot | null): Promise<OfflineSnapshot | null> {
  if (!cached || cached.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return fetchFullSnapshot();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${API_BASE}/offline/delta?sinceRevision=${encodeURIComponent(cached.revision)}`, { signal: controller.signal, cache: "no-cache" });
    if (!res.ok) return cached;
    const delta = (await res.json()) as DeltaResponse;
    if (delta.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return fetchFullSnapshot();
    if (delta.full) return fetchFullSnapshot();
    if (delta.revision === cached.revision && delta.changedLines.length === 0 && delta.removedLineIds.length === 0) return cached;

    const byId = new Map(cached.lines.map((l) => [l.id, l]));
    for (const line of delta.changedLines) byId.set(line.id, line);
    for (const id of delta.removedLineIds) byId.delete(id);
    const merged: OfflineSnapshot = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      revision: delta.revision,
      types: delta.types?.length ? delta.types : cached.types,
      lines: [...byId.values()],
    };
    await writeCachedSnapshot(merged);
    return merged;
  } catch {
    return cached;
  } finally {
    window.clearTimeout(timer);
  }
}

async function getSnapshot(): Promise<OfflineSnapshot | null> {
  const cached = await readCachedSnapshot().catch(() => null);
  const stale = !cached || Date.now() - cached.savedAt > SNAPSHOT_REFRESH_MS;
  if (stale) {
    const synced = await syncSnapshot(cached?.snapshot ?? null);
    if (synced) return synced;
  }
  return cached?.snapshot ?? null;
}

// ── public API ───────────────────────────────────────────────────────────────
function resolvePlanKey(tripType: string): PlanKey {
  return tripType === "economic" || tripType === "premium" ? tripType : "comfortable";
}

// Produce up to four labeled route cards for the chosen plan tier. Each card is
// a complete, validated plan; the rider swipes between them and picks one.
export async function planTripsOnDevice(request: PlannerRequest): Promise<ApiPlan[]> {
  if (request.mode && request.mode !== "city") return [];
  const planKey = resolvePlanKey(request.tripType);
  const isArabic = request.language === "ar";
  const snapshot = await getSnapshot();
  if (!snapshot) return [];

  const origin = { lat: request.startLat, lng: request.startLng };
  const dest = { lat: request.endLat, lng: request.endLng };
  const directKm = haversineKm(origin, dest);

  const graph = buildGraph(snapshot, origin, dest, planKey);
  const profiles = cardProfiles(planKey);
  const seen = new Set<string>();
  const plans: ApiPlan[] = [];

  for (const profile of profiles) {
    const goals = search(graph, profile, planKey, 6);
    let chosen: ApiPlan | null = null;
    for (const goal of goals) {
      const rawLegs = toRawLegs(graph, goal);
      if (!rawLegs) continue;
      if (rejectRawLegs(rawLegs, graph, directKm)) continue;
      const segments = await buildSegments(graph, rawLegs, request, isArabic);
      if (!segments || !segments.length) continue;
      const sig = planSignature(segments);
      if (seen.has(sig)) continue;
      chosen = finalizePlan(segments, request, graph, snapshot, planKey, directKm, CARD_LABELS[profile.key]);
      seen.add(sig);
      break;
    }
    if (chosen) plans.push(chosen);
  }

  // Order so the Recommended card is first, then the rest in profile order.
  return plans;
}

// Back-compat single-plan entry point used by older callers. Returns the
// Recommended card (or the best available).
export async function planTripOnDevice(request: PlannerRequest): Promise<ApiPlan | null> {
  const plans = await planTripsOnDevice(request);
  return plans[0] ?? null;
}

export type { ApiPlan, ApiSegment, RouteCardLabel };
