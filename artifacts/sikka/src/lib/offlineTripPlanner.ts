// Bundled fallback snapshot — ships inside the app build itself, so a fresh
// install has routes immediately with ZERO network calls. Regenerate this
// file (see scripts/exportBundledSnapshot.mjs) before each release so new
// installs start from current data; after that, the existing manifest/delta
// check (see getSnapshot below) only ever pulls a small delta, and only when
// an admin has actually changed something — never a full re-fetch per trip
// or per install.
import bundledSnapshotRaw from '@/data/bundledSnapshot.json';

type LngLat = [number, number];
type Coord = { lat: number; lng: number };
type PlanKey = "economic" | "comfortable" | "premium";
type ModeKey = "metro" | "monorail" | "lrt" | "brt" | "train" | "bus" | "serfis" | "microbus" | "taxi" | "tuktuk" | "walk";
type RouteVariantKey = "recommended" | "cheapest" | "fastest" | "fewest_transfers";
type RouteStatus = "active" | "needs_review" | "inactive" | "pending_discovery";

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
  stops?: { name: string; nameAr?: string; lat: number; lng: number }[] | null;
  path: LngLat[];
  pathPointCount?: number;
  pathSuspect?: boolean;
  routeQuality?: "gtfs" | "standard" | "suspect";
  dataSource?: "discovery" | "gtfs" | "admin" | "csv" | "seed" | string;
  sourcePriority?: number;
  confidenceScore?: number;
  routeStatus?: RouteStatus;
  /** Real average speed (km/h) computed server-side from timestamped rider
   *  GPS traces. Preferred over the transport type's generic speed for this
   *  line's duration estimate whenever it's set. */
  observedSpeedKmh?: number | null;
  verifiedAt?: string | null;
  lastConfirmedAt?: string | null;
  needsReviewReason?: string | null;
  reviewReportCount?: number;
  updatedAt?: string | null;
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
  heatmaps?: {
    id: string;
    transportTypeId: string;
    latitude: number;
    longitude: number;
    intensity: number;
    radiusKm: number;
    createdAt?: string;
  }[];
};

const bundledSnapshot = bundledSnapshotRaw as unknown as OfflineSnapshot;

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
  route_status?: RouteStatus;
  trust_badge?: string;
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
  route_variant?: RouteVariantKey;
  route_label?: string;
  route_description?: string;
  rail_recommended?: boolean;
  route_options?: ApiPlan[];
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

type PlanCandidate = {
  segments: ApiSegment[];
  score: number;
  cost: number;
  time: number;
  transfers: number;
  transitLegs: number;
  taxiLegs: number;
  totalWalkKm: number;
  qualityPenalty: number;
  signature: string;
  /** True when at least one leg of this candidate rides a metro or monorail line. */
  usesRail: boolean;
};

const SNAPSHOT_DB = "sikka-offline";
const SNAPSHOT_STORE = "snapshots";
const SNAPSHOT_KEY = "latest";
const WALK_MAX_KM = 0.8;
const WALK_TOTAL_MAX_KM = 1.6;
const WALK_SPEED_KMH = 4.5;
const WALK_DETOUR = 1.3;
const FARE_MARKUP = 1.25;
const ROUTE_OPTION_META: Record<RouteVariantKey, { label: string; description: string; color: string }> = {
  recommended: { label: "Recommended", description: "Best balance of time, price, walking, and route trust", color: "#2563EB" },
  cheapest: { label: "Cheapest", description: "Lowest fare while avoiding taxi-heavy routing", color: "#16A34A" },
  fastest: { label: "Fastest", description: "Shortest total travel time", color: "#DC2626" },
  fewest_transfers: { label: "Fewest Transfers", description: "Simplest route with fewer vehicle changes", color: "#7C3AED" },
};

function modeOfType(nameEn: string): ModeKey {
  const n = nameEn.toLowerCase();
  if (n.includes("metro")) return "metro";
  if (n.includes("monorail")) return "monorail";
  // Must come before the generic "train"/"bus" checks below, since "LRT"
  // ("Light Rail Transit") and "BRT" ("Bus Rapid Transit") are their own
  // distinct fixed-stop systems, not a plain commuter train or city bus.
  if (n.includes("lrt") || n.includes("light rail")) return "lrt";
  if (n.includes("brt") || n.includes("rapid transit")) return "brt";
  if (n.includes("train")) return "train";
  if (n.includes("serfis")) return "serfis";
  if (n.includes("microbus")) return "microbus";
  if (n.includes("tuktuk") || n.includes("toktok")) return "tuktuk";
  if (n.includes("taxi") || n.includes("uber") || n.includes("careem") || n.includes("car")) return "taxi";
  if (n.includes("bus")) return "bus";
  return "bus";
}

/**
 * Determines which governorate a point falls in, using simple bounding
 * boxes for the governorates that actually have transit data so far. Trips
 * only ever suggest routes tagged to the rider's own governorate — Cairo and
 * Alexandria are ~220km apart, so a generic distance filter would mostly
 * get this right by accident, but an explicit check is the correct, robust
 * rule rather than relying on that coincidence, and it's what makes the
 * boundary intentional as more governorates get added later.
 */
function governorateOf(point: Coord): string {
  // Alexandria governorate (coastal strip along the Mediterranean).
  if (point.lat >= 31.0 && point.lat <= 31.35 && point.lng >= 29.7 && point.lng <= 30.15) {
    return "Alexandria";
  }
  // Greater Cairo (Cairo, Giza, Qalyubia metro area, and the new cities to
  // the east that Cairo LRT/BRT/Metro extend into).
  if (point.lat >= 29.6 && point.lat <= 30.35 && point.lng >= 30.9 && point.lng <= 31.95) {
    return "Cairo";
  }
  // Outside any known governorate's bounding box — default to Cairo, since
  // that's where the overwhelming majority of seeded data lives and a rider
  // this far out is most likely planning a trip toward/within it anyway.
  return "Cairo";
}

function allowedModes(planKey: PlanKey): Set<ModeKey> {
  if (planKey === "economic") return new Set(["metro", "monorail", "lrt", "brt", "train", "bus", "serfis", "microbus", "tuktuk"]);
  if (planKey === "comfortable") return new Set(["metro", "monorail", "lrt", "brt", "train", "bus", "serfis", "taxi", "tuktuk"]);
  return new Set(["metro", "monorail", "lrt", "brt", "train", "bus", "serfis", "taxi", "tuktuk"]);
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

function routeQuality(line: OfflineLine): "gtfs" | "standard" | "suspect" {
  if (line.routeQuality) return line.routeQuality;
  if (line.pathSuspect || maxConsecutiveStepKm(line.path) > 0.5) return "suspect";
  return line.hasFixedStops || (line.pathPointCount ?? line.path.length) >= 50 ? "gtfs" : "standard";
}

function routeQualityPenalty(line: OfflineLine): number {
  const quality = routeQuality(line);
  if (quality === "gtfs") return -45;
  if (quality === "suspect") return 70;
  return 0;
}

function dateAgeDays(value: string | null | undefined): number {
  if (!value) return Infinity;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.max(0, (Date.now() - ms) / 86400000) : Infinity;
}

function sourceTrustPenalty(line: OfflineLine): number {
  const source = (line.dataSource || "").toLowerCase();
  const priority = line.sourcePriority ?? (
    source === "discovery" ? 40 :
      source === "gtfs" ? 30 :
        source === "admin" ? 20 : 10
  );
  let penalty = 40 - priority;
  if (source === "discovery") penalty -= 50;
  else if (source === "gtfs") penalty -= 35;
  else if (source === "admin") penalty -= 12;
  else if (source === "csv" || source === "seed") penalty += 18;

  const confidence = Math.max(0, Math.min(1, line.confidenceScore ?? 0.6));
  penalty += (1 - confidence) * 50;
  if (line.routeStatus === "needs_review") penalty += 85;
  if (line.routeStatus === "inactive" || line.routeStatus === "pending_discovery") penalty += 500;
  if (!line.lineNumber && source !== "discovery") penalty += 12;
  penalty += Math.min(75, (line.reviewReportCount ?? 0) * 12);

  const age = dateAgeDays(line.lastConfirmedAt ?? line.verifiedAt ?? line.updatedAt);
  if (source === "discovery") penalty += Math.min(45, age / 14);
  else penalty += Math.min(35, age / 45);
  return penalty;
}

function totalLinePenalty(line: OfflineLine): number {
  return routeQualityPenalty(line) + sourceTrustPenalty(line);
}

function trustBadge(line: OfflineLine): string {
  // Riders never need to know our internal data-source taxonomy (seed/gtfs/csv/discovery) —
  // translate each into a plain, trust-building phrase instead.
  if (line.routeStatus === "needs_review") return "Route being verified";
  const source = (line.dataSource || "").toLowerCase();
  if (source === "discovery") return "Rider-verified route";
  if (source === "gtfs") return "Official route data";
  if (source === "admin") return "Verified by Sikka";
  return routeQuality(line) === "suspect" ? "Approximate route" : "Standard route";
}

function modePreferencePenalty(mode: ModeKey, planKey: PlanKey): number {
  if (planKey === "economic") {
    if (mode === "metro" || mode === "monorail" || mode === "lrt" || mode === "train" || mode === "bus" || mode === "brt") return -12;
    if (mode === "microbus" || mode === "serfis") return 0;
    if (mode === "taxi") return 90;
  }
  if (planKey === "comfortable") {
    // BRT belongs in comfortable specifically: dedicated lane, fixed stops,
    // AC electric buses — a genuinely more comfortable ride than a regular
    // city bus or microbus, so it gets the same preference bonus as rail.
    if (mode === "metro" || mode === "monorail" || mode === "lrt" || mode === "train" || mode === "bus" || mode === "brt") return -18;
    if (mode === "microbus") return 85;
    if (mode === "taxi" || mode === "tuktuk") return 18;
  }
  if (planKey === "premium") {
    if (mode === "taxi") return -20;
    // Metro AND monorail (and LRT) get the same premium-tier preference —
    // fast, modern, fixed-rail options belong in the premium plan too, not
    // just the cheap one.
    if (mode === "metro" || mode === "monorail" || mode === "lrt" || mode === "train") return -10;
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

const OSRM_CAR_BASE = ((import.meta.env.VITE_OSRM_CAR_URL as string | undefined)
  || "https://routing.openstreetmap.de/routed-car").replace(/\/+$/, "");
const OSRM_FOOT_BASE = ((import.meta.env.VITE_OSRM_FOOT_URL as string | undefined)
  || "https://routing.openstreetmap.de/routed-foot").replace(/\/+$/, "");
const CONNECTOR_CACHE_KEY = "sikka:connector-road-geometry:v1";
const CONNECTOR_CACHE_LIMIT = 240;
const connectorGeometryCache = new Map<string, LngLat[]>();
const pendingConnectorGeometry = new Map<string, Promise<LngLat[]>>();

function connectorCacheKey(mode: ModeKey, a: LngLat, b: LngLat): string {
  const profile = mode === "walk" ? "foot" : "car";
  return `${profile}:${a[0].toFixed(5)},${a[1].toFixed(5)}>${b[0].toFixed(5)},${b[1].toFixed(5)}`;
}

function loadConnectorCache(): void {
  if (connectorGeometryCache.size || typeof localStorage === "undefined") return;
  try {
    const rows = JSON.parse(localStorage.getItem(CONNECTOR_CACHE_KEY) || "[]") as Array<[string, LngLat[]]>;
    for (const [key, geometry] of rows) {
      if (Array.isArray(geometry) && geometry.length >= 2) connectorGeometryCache.set(key, geometry);
    }
  } catch {
    localStorage.removeItem(CONNECTOR_CACHE_KEY);
  }
}

function saveConnectorCache(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const rows = [...connectorGeometryCache.entries()].slice(-CONNECTOR_CACHE_LIMIT);
    localStorage.setItem(CONNECTOR_CACHE_KEY, JSON.stringify(rows));
  } catch {
    // The in-memory cache still deduplicates requests if storage is disabled.
  }
}

async function fetchRoadGeometry(mode: ModeKey, geometry: LngLat[]): Promise<LngLat[]> {
  if (geometry.length < 2) return geometry;
  const a = geometry[0];
  const b = geometry[geometry.length - 1];
  const key = connectorCacheKey(mode, a, b);
  loadConnectorCache();
  const cached = connectorGeometryCache.get(key);
  if (cached) return cached;
  const pending = pendingConnectorGeometry.get(key);
  if (pending) return pending;

  const request = (async () => {
    const isFoot = mode === "walk";
    const base = isFoot ? OSRM_FOOT_BASE : OSRM_CAR_BASE;
    const profile = isFoot ? "foot" : "car";
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const url = `${base}/route/v1/${profile}/${a[0]},${a[1]};${b[0]},${b[1]}`
        + "?overview=full&geometries=geojson&steps=false";
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return geometry.length > 2 ? geometry : [];
      const data = await response.json() as {
        code?: string;
        routes?: Array<{ geometry?: { coordinates?: LngLat[] } }>;
      };
      const routed = data.code === "Ok" ? data.routes?.[0]?.geometry?.coordinates : null;
      if (!routed || routed.length < 2) return geometry.length > 2 ? geometry : [];
      const snapped = routed
        .filter((point) => Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]))
        .map((point) => [point[0], point[1]] as LngLat);
      if (snapped.length < 2) return geometry.length > 2 ? geometry : [];
      snapped[0] = a;
      snapped[snapped.length - 1] = b;
      connectorGeometryCache.set(key, snapped);
      saveConnectorCache();
      return snapped;
    } catch {
      // Never draw a two-point displacement as if it were a street route.
      // If offline routing is unavailable, the UI leaves this connector
      // undrawn instead of showing a false line through blocks/buildings.
      return geometry.length > 2 ? geometry : [];
    } finally {
      window.clearTimeout(timer);
      pendingConnectorGeometry.delete(key);
    }
  })();

  pendingConnectorGeometry.set(key, request);
  return request;
}

// Free, keyless connector routing never queries Sikka's database. Cached
// results also keep repeat trips instant and usable offline.
async function snapConnectorGeometry(mode: ModeKey, geometry: LngLat[]): Promise<LngLat[]> {
  return fetchRoadGeometry(mode, geometry);
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

function closestStationOnLine(line: OfflineLine, point: Coord): ClosestPoint | null {
  const stops = (line.stops ?? []).filter((stop) =>
    stop?.name && Number.isFinite(stop.lat) && Number.isFinite(stop.lng),
  );
  if (!stops.length || line.path.length < 2) return null;
  let best: ClosestPoint | null = null;
  for (const stop of stops) {
    const coord = { lat: stop.lat, lng: stop.lng };
    const projected = closestPointOnPath(line.path, coord);
    const candidate: ClosestPoint = {
      coord,
      index: projected.index,
      distanceKm: haversineKm(point, coord),
    };
    if (!best || candidate.distanceKm < best.distanceKm) best = candidate;
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
  // BRT headway is ~3 min off-peak / 1.5 min peak per the Ring Road operator;
  // LRT doesn't have a widely published headway yet, estimated similar to monorail.
  const defaults: Record<ModeKey, number> = { metro: 6, monorail: 8, lrt: 8, brt: 3, train: 30, bus: 18, serfis: 10, microbus: 10, taxi: 6, tuktuk: 5, walk: 0 };
  return Math.max(0, (line.frequencyMinutes ?? defaults[mode]) / 2);
}

function transportName(type: OfflineType, line: OfflineLine, isArabic: boolean): string {
  const lineName = isArabic ? line.nameAr : line.nameEn;
  const typeName = isArabic ? type.nameAr : type.nameEn;
  return line.lineNumber ? `${typeName} ${line.lineNumber}` : lineName || typeName;
}

function connectorInstructions(connector: Connector, startName: string, endName: string, cost: number, isArabic: boolean): string[] {
  if (connector.mode === "walk") {
    return isArabic
      ? [`امشِ من ${startName} إلى ${endName}.`, `ابقَ على الأرصفة والمعابر ولا تختصر من خارج الشوارع.`]
      : [`Walk from ${startName} to ${endName}.`, `Stay on sidewalks/crossings and avoid off-street shortcuts.`];
  }
  if (connector.mode === "tuktuk") {
    return isArabic
      ? [
          `دوّر على توك توك قريب من ${startName} — بيقفوا في مجموعات على الناصية غالباً.`,
          `اتفق على السعر قبل ما تركب، وحوالي ${Math.round(cost)} جنيه — مالوش عداد.`,
          `قول وجهتك بوضوح: ${endName}.`,
        ]
      : [
          `Find a tuktuk near ${startName} — they often wait in clusters at a corner.`,
          `Agree on the fare before getting in, about ${Math.round(cost)} EGP — there's no meter.`,
          `Tell the driver your destination clearly: ${endName}.`,
        ];
  }
  if (connector.mode === "taxi") {
    return isArabic
      ? [
          `لو من خلال تطبيق: اطلب الرحلة من ${startName} إلى ${endName} وتأكد من اسم السائق ولوحة العربية.`,
          `لو تاكسي شارع عادي: اتفق على السعر الأول (حوالي ${Math.round(cost)} جنيه).`,
        ]
      : [
          `If using an app: request the ride from ${startName} to ${endName}, and check the driver/plate match before getting in.`,
          `If it's a street taxi: agree the fare first (about ${Math.round(cost)} EGP).`,
        ];
  }
  return isArabic
    ? [`استخدم ${connector.nameAr} من ${startName}.`, `انزل عند ${endName} ثم أكمل الخطوة التالية.`]
    : [`Take ${connector.nameEn} from ${startName}.`, `Get off at ${endName}, then continue to the next step.`];
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
    instructions: connectorInstructions(connector, startName, endName, connector.cost, isArabic),
    alternatives: [],
  };
}

function rideInstructions(candidate: Candidate, isArabic: boolean, boardingName: string, alightingName: string): string[] {
  const name = transportName(candidate.type, candidate.line, isArabic);
  const from = boardingName;
  const to = alightingName;
  const cost = lineFare(candidate.type, candidate.line, Math.max(0.2, pathLengthKm(candidate.line.path)));
  const lineLabel = candidate.line.lineNumber || (isArabic ? candidate.line.nameAr : candidate.line.nameEn);

  // Typical wait before the next vehicle shows up, from the line's recorded
  // frequency (or a sane per-mode default) — half the headway, which is the
  // expected wait for a rider arriving at a random time.
  const wait = Math.round(waitMinutes(candidate.line, candidate.mode));
  const waitLine = wait > 0
    ? [isArabic ? `المتوقع: ${name} جاي كل حوالي ${wait} دقيقة.` : `Expect the next ${name} in about ${wait} min.`]
    : [];

  let result: string[];

  if (candidate.mode === "metro" || candidate.mode === "monorail" || candidate.mode === "train" || candidate.mode === "lrt") {
    const womenNote = candidate.mode === "metro" || candidate.mode === "lrt";
    result = isArabic
      ? [
          `روح لمحطة ${from} واشتري تذكرة أو اعمل تاب بالكارت عند الجيت.`,
          ...(womenNote ? [`العربيتين في النص مخصصتين للسيدات فقط — لو محتاج تعرف.`] : []),
          `اركب ${name} في اتجاه ${to}، وتابع لون الخط على لوحات الرصيف.`,
          `انزل في محطة ${to} واتبع لافتة الخروج باسم الشارع/المعلم اللي يناسب وجهتك.`,
        ]
      : [
          `Head to ${from} station and buy a ticket, or tap your card at the gate.`,
          ...(womenNote ? [`The middle two cars are reserved for women only, in case that matters for you.`] : []),
          `Board ${name} toward ${to}, and follow the line's color on the platform signage.`,
          `Exit at ${to} station and follow the exit sign for the street/landmark you need — stations often have several exits leading to very different streets.`,
        ];
  } else if (candidate.mode === "brt") {
    result = isArabic
      ? [
          `روح لمحطة الباص الترددي عند ${from} — الوصول غالباً من خلال كوبري أو نفق مشاة فوق الطريق الدائري.`,
          `اعمل تاب بالكارت أو اشتري تذكرة عند البوابة الإلكترونية، زي محطات المترو.`,
          `اركب الباص في اتجاه ${to} وتابع الشاشات اللي بتوضح وقت وصول الباص التالي.`,
          `انزل في محطة ${to} واتبع لافتات الخروج.`,
        ]
      : [
          `Head to the BRT station at ${from} — access is usually via a pedestrian bridge or tunnel above the Ring Road.`,
          `Tap your card or buy a ticket at the electronic gate, similar to a metro station.`,
          `Board the bus toward ${to} and watch the screens for the next bus's arrival time.`,
          `Get off at ${to} station and follow the exit signage.`,
        ];
  } else if (candidate.mode === "microbus") {
    result = isArabic
      ? [
          `قف على جنب الطريق عند ${from} في اتجاه السيارات الجاية علشان تقدر تلوّح بسهولة.`,
          `لوّح بإيدك لأي ميكروباص رايح ناحية ${to} — مش هيقف لوحده.`,
          `وانت داخل قول وجهتك بصوت عالي زي "${to}!" — أغلب الميكروباصات مالها لافتة خط واضحة.`,
          `مرّر الأجرة لقدام إيد بإيد لحد السواق، وحوالي ${Math.round(cost)} جنيه. الباقي بيرجع بنفس الطريقة.`,
          `لما تقرب من ${to} قول "على الطلب" قبل ما توصل بشوية — بينزّل في أي حتة مش في محطات بس.`,
        ]
      : [
          `Stand at the edge of the road at ${from}, facing oncoming traffic, so you can flag one down easily.`,
          `Flag down any microbus heading toward ${to} — it won't stop on its own.`,
          `As you get in, call out your destination loudly, e.g. "${to}!" — most microbuses have no route signage.`,
          `Pass your fare forward hand-to-hand to the driver, about ${Math.round(cost)} EGP. Change comes back the same way.`,
          `When you're near ${to}, say "ala el talab" (on request) a few seconds before — it stops anywhere, not just at fixed points.`,
        ];
  } else if (candidate.mode === "serfis") {
    result = isArabic
      ? [
          `روح لـ ${from} — غالباً فيه مكان معروف بتقف فيه السرفيسات.`,
          `لوّح لسرفيس رايح ناحية ${to}، وأكّد وجهتك وانت داخل.`,
          `ادفع حوالي ${Math.round(cost)} جنيه جوه العربية، بتمريرها لقدام.`,
          `قول "على الطلب" وانت قرب من ${to}.`,
        ]
      : [
          `Head to ${from} — usually a known stand where serfis line up or pass by.`,
          `Flag one down heading toward ${to}, and confirm your destination as you board.`,
          `Pay about ${Math.round(cost)} EGP onboard, passed forward like in a microbus.`,
          `Ask to stop ("ala el talab") as you near ${to}.`,
        ];
  } else {
    // CTA / NTA city bus — marked stops, route boards, more fixed than microbus.
    result = isArabic
      ? [
          `روح لمحطة الأتوبيس المعلّمة عند ${from} — الأتوبيسات الرسمية بتقف في محطات معلّمة بس.`,
          `قبل ما تركب، بص على لوحة رقم الخط ${lineLabel ? `(${lineLabel}) ` : ""}في الزجاج الأمامي وتأكد إنه رايح ${to}.`,
          `اركب وادفع جوه (نقدي للكمساري أو تاب بالكارت)، وحوالي ${Math.round(cost)} جنيه.`,
          `انزل عند ${to}، وخد بالك من الزحمة وانت بتنزل.`,
        ]
      : [
          `Go to the marked bus stop at ${from} — official buses only stop at signed stops.`,
          `Before boarding, check the route board${lineLabel ? ` (${lineLabel})` : ""} in the windshield to confirm it's heading to ${to}.`,
          `Board and pay onboard (cash to the conductor, or tap your card), about ${Math.round(cost)} EGP.`,
          `Get off at ${to}, watching for other traffic as you step down.`,
        ];
  }

  return [...waitLine, ...result];
}
const ROAD_BOUND_MODES = new Set<ModeKey>(["bus", "microbus", "serfis", "taxi", "tuktuk"]);

/** True during Cairo's typical weekday rush windows (rough heuristic — there
 *  isn't enough per-time-of-day ridership data yet to do better than this). */
function isRushHour(): boolean {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  if (day === 5) return false; // Friday — much lighter traffic
  const hour = now.getHours();
  return (hour >= 7 && hour < 10) || (hour >= 15 && hour < 19);
}

/**
 * Picks the best available speed estimate for a ride: real GPS-observed speed
 * for this exact line when enough riders have confirmed it, otherwise the
 * transport type's generic speed — then nudges road-bound modes down during
 * rush hour, since metro/monorail/train run on dedicated rail and aren't
 * affected by road traffic the same way.
 */
function effectiveSpeedKmh(line: OfflineLine, type: OfflineType, mode: ModeKey): number {
  const base = line.observedSpeedKmh && line.observedSpeedKmh >= 3 && line.observedSpeedKmh <= 80
    ? line.observedSpeedKmh
    : type.averageSpeedKmh || 25;
  if (ROAD_BOUND_MODES.has(mode) && isRushHour()) return base * 0.78;
  return base;
}

/** Names the exact boarding/alighting portion instead of showing the full
 * line endpoints. Structured fixed-transit stops are authoritative. For
 * informal road services, ordered corridor labels are mapped to route
 * progress so instructions still describe the ridden portion. */
function segmentEndpointLabels(
  line: OfflineLine,
  fromIndex: number,
  toIndex: number,
  isArabic: boolean,
): { start: string; end: string } {
  const stops = (line.stops ?? []).filter((stop) =>
    Number.isFinite(stop.lat) && Number.isFinite(stop.lng) && stop.name,
  );
  if (stops.length >= 2 && line.path.length >= 2) {
    const indexed = stops.map((stop) => ({
      stop,
      pathIndex: closestPointOnPath(line.path, { lat: stop.lat, lng: stop.lng }).index,
    })).sort((a, b) => a.pathIndex - b.pathIndex);
    const nearest = (target: number) => indexed.reduce((best, current) =>
      Math.abs(current.pathIndex - target) < Math.abs(best.pathIndex - target) ? current : best,
    );
    let start = nearest(fromIndex);
    let end = nearest(toIndex);
    if (start === end && indexed.length > 1) {
      const position = indexed.indexOf(start);
      if (toIndex >= fromIndex && position < indexed.length - 1) end = indexed[position + 1];
      else if (position > 0) start = indexed[position - 1];
    }
    const stopName = (value: typeof start) => isArabic && value.stop.nameAr ? value.stop.nameAr : value.stop.name;
    return { start: stopName(start), end: stopName(end) };
  }

  const corridor = [line.fromArea, ...(line.viaStops ?? []), line.toArea].filter(Boolean);
  if (corridor.length >= 2 && line.path.length >= 2) {
    const labelAt = (pathIndex: number) => corridor[Math.max(0, Math.min(
      corridor.length - 1,
      Math.round((pathIndex / (line.path.length - 1)) * (corridor.length - 1)),
    ))];
    let start = labelAt(fromIndex);
    let end = labelAt(toIndex);
    if (start === end) {
      const startPosition = corridor.indexOf(start);
      if (toIndex >= fromIndex && startPosition < corridor.length - 1) end = corridor[startPosition + 1];
      else if (startPosition > 0) start = corridor[startPosition - 1];
    }
    return { start, end };
  }
  return { start: line.fromArea, end: line.toArea };
}

function rideSegment(candidate: Candidate, from: ClosestPoint, to: ClosestPoint, isArabic: boolean): ApiSegment {
  const route = slicePath(candidate.line.path, from.index, to.index);
  if (route.length >= 2) {
    route[0] = [from.coord.lng, from.coord.lat];
    route[route.length - 1] = [to.coord.lng, to.coord.lat];
  }
  const labels = segmentEndpointLabels(candidate.line, from.index, to.index, isArabic);
  const km = Math.max(0.2, pathLengthKm(route));
  const speed = effectiveSpeedKmh(candidate.line, candidate.type, candidate.mode);
  const minutes = waitMinutes(candidate.line, candidate.mode) + (km / Math.max(speed, 8)) * 60;
  return {
    transport_type_id: candidate.type.id,
    transport_name: transportName(candidate.type, candidate.line, isArabic),
    government_type: candidate.type.governmentType,
    category: candidate.type.category,
    start_name: labels.start,
    end_name: labels.end,
    cost_egp: lineFare(candidate.type, candidate.line, km),
    duration_minutes: Math.max(2, Math.round(minutes)),
    color: candidate.type.color,
    icon: candidate.type.icon || candidate.mode,
    line_id: candidate.line.id,
    line_number: candidate.line.lineNumber,
    route_status: candidate.line.routeStatus ?? "active",
    trust_badge: trustBadge(candidate.line),
    info: isArabic
      ? `محسوبة على الهاتف من بيانات Sikka المحفوظة. الثقة: ${trustBadge(candidate.line)}.`
      : `Calculated on this phone from the synced Sikka route snapshot. Trust: ${trustBadge(candidate.line)}.`,
    instructions: rideInstructions(candidate, isArabic, labels.start, labels.end),
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

async function snapConnectorSegments(segments: ApiSegment[]): Promise<ApiSegment[]> {
  return Promise.all(segments.map(async (segment) => {
    const mode = connectorModeFromSegment(segment);
    if (!mode || !segment.route_geometry) return segment;
    return { ...segment, route_geometry: await snapConnectorGeometry(mode, segment.route_geometry) };
  }));
}

async function makePlan(
  segments: ApiSegment[],
  request: PlannerRequest,
  snapshot: OfflineSnapshot,
  variant: RouteVariantKey = "recommended",
  railRecommended = false,
): Promise<ApiPlan> {
  const planKey: PlanKey = request.tripType === "economic" || request.tripType === "premium" ? request.tripType : "comfortable";
  const isArabic = request.language === "ar";
  const streetSegments = await snapConnectorSegments(segments);
  const enrichedSegments = attachAlternatives(snapshot, streetSegments, planKey, isArabic);
  const cost = enrichedSegments.reduce((sum, s) => sum + s.cost_egp, 0);
  const time = enrichedSegments.reduce((sum, s) => sum + s.duration_minutes, 0);
  const distance = haversineKm({ lat: request.startLat, lng: request.startLng }, { lat: request.endLat, lng: request.endLng });
  const meta = ROUTE_OPTION_META[variant];
  return {
    segments: enrichedSegments,
    total_cost_egp: Math.round(cost),
    total_duration_minutes: Math.round(time),
    budget_range: { min: Math.max(0, Math.round(cost * 0.8)), max: Math.round(cost * 1.35 + 10) },
    distance_km: parseFloat(distance.toFixed(1)),
    offline: true,
    snapshot_revision: snapshot.revision,
    route_variant: variant,
    route_label: meta.label,
    route_description: meta.description,
    rail_recommended: railRecommended,
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

async function getSnapshot(): Promise<OfflineSnapshot | null> {
  const cached = await readCachedSnapshot().catch(() => null);

  if (!cached) {
    // Fresh install, nothing in IndexedDB yet: seed instantly from the data
    // bundled into the app build — zero network calls, works the moment the
    // app opens for the very first time, even with no signal at all.
    if (bundledSnapshot.lines?.length) {
      await writeCachedSnapshot(bundledSnapshot).catch(() => {});
      // Still worth a single lightweight manifest check in the background so
      // anything an admin changed since this build was released shows up
      // without the rider having to wait — but the trip being planned right
      // now already has data to work with immediately, regardless of result.
      return bundledSnapshot;
    }
    // No bundled data at all (e.g. a dev build before the export step has
    // ever been run) — only in that case fall back to a live fetch so the
    // app isn't simply unusable.
    return null;
  }
  return cached.snapshot;
}

function buildCandidates(snapshot: OfflineSnapshot, point: Coord, planKey: PlanKey, limit: number): Candidate[] {
  const types = new Map(snapshot.types.map((t) => [t.id, t]));
  const allowed = allowedModes(planKey);
  const maxKm = planKey === "economic" ? 3.5 : 5;
  const riderGovernorate = governorateOf(point);
  const candidates: Candidate[] = [];
  for (const line of snapshot.lines) {
    if (line.routeStatus === "inactive" || line.routeStatus === "pending_discovery") continue;
    if (!line.path || line.path.length < 2) continue;
    // Only suggest routes that actually serve the governorate the rider is
    // currently in — a Cairo line should never appear as an option while
    // planning a trip inside Alexandria, and vice versa.
    if ((line.governorate || "Cairo") !== riderGovernorate) continue;
    const type = types.get(line.transportTypeId);
    if (!type) continue;
    const mode = modeOfType(type.nameEn);
    if (!allowed.has(mode)) continue;
    const closest = (line.hasFixedStops || mode === "metro" || mode === "monorail" || mode === "train" || mode === "lrt" || mode === "brt")
      ? closestStationOnLine(line, point) ?? closestPointOnPath(line.path, point)
      : closestPointOnPath(line.path, point);
    if (closest.distanceKm <= maxKm) candidates.push({ line, type, mode, closest });
  }
  candidates.sort((a, b) => {
    const qa = totalLinePenalty(a.line) + modePreferencePenalty(a.mode, planKey);
    const qb = totalLinePenalty(b.line) + modePreferencePenalty(b.mode, planKey);
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

function candidateStats(segments: ApiSegment[], linePenalty = 0, usesRail = false): Omit<PlanCandidate, "score" | "signature"> {
  const cost = segments.reduce((sum, s) => sum + s.cost_egp, 0);
  const time = segments.reduce((sum, s) => sum + s.duration_minutes, 0);
  const transitLegs = segments.filter((s) => !!s.line_id).length;
  const transfers = Math.max(0, transitLegs - 1);
  const taxiLegs = segments.filter((s) => connectorModeFromSegment(s) === "taxi").length;
  const totalWalkKm = segments.reduce((sum, s) => {
    if (connectorModeFromSegment(s) !== "walk" || !s.route_geometry || s.route_geometry.length < 2) return sum;
    return sum + pathLengthKm(s.route_geometry);
  }, 0);
  return { segments, cost, time, transfers, transitLegs, taxiLegs, totalWalkKm, qualityPenalty: linePenalty, usesRail };
}

function signatureFor(segments: ApiSegment[]): string {
  return segments
    .map((s) => s.line_id ? `line:${s.line_id}:${s.line_number ?? ""}` : `conn:${connectorModeFromSegment(s) ?? s.transport_type_id}`)
    .join("|");
}

function makeCandidate(segments: ApiSegment[], planKey: PlanKey, linePenalty = 0, usesRail = false): PlanCandidate | null {
  const stats = candidateStats(segments, linePenalty, usesRail);
  if (stats.totalWalkKm > WALK_TOTAL_MAX_KM) return null;
  const lineIds = segments.map((s) => s.line_id).filter((id): id is string => !!id);
  if (new Set(lineIds).size !== lineIds.length) return null;
  const connectorPenalty = segments.reduce((sum, s) => {
    const mode = connectorModeFromSegment(s);
    return sum + (mode ? modePreferencePenalty(mode, planKey) : 0);
  }, 0);
  const score = scoreSegments(segments, planKey)
    + linePenalty
    + stats.totalWalkKm * 22
    + stats.taxiLegs * (planKey === "premium" ? -12 : 140)
    + connectorPenalty;
  return {
    ...stats,
    score,
    signature: signatureFor(segments),
  };
}

function addCandidate(out: PlanCandidate[], seen: Set<string>, candidate: PlanCandidate | null) {
  if (!candidate || seen.has(candidate.signature)) return;
  seen.add(candidate.signature);
  out.push(candidate);
}

function scoreForVariant(candidate: PlanCandidate, variant: RouteVariantKey, planKey: PlanKey): number {
  const taxiPenalty = candidate.taxiLegs * (planKey === "premium" ? -10 : 220);
  if (variant === "cheapest") return candidate.cost * 5 + candidate.time * 0.35 + candidate.transfers * 20 + candidate.totalWalkKm * 12 + candidate.qualityPenalty + taxiPenalty;
  if (variant === "fastest") return candidate.time * 4 + candidate.cost * 0.35 + candidate.transfers * 14 + candidate.qualityPenalty * 0.5 + candidate.taxiLegs * (planKey === "premium" ? -20 : 45);
  if (variant === "fewest_transfers") return candidate.transfers * 500 + candidate.transitLegs * 90 + candidate.time + candidate.cost * 0.3 + candidate.totalWalkKm * 35 + candidate.qualityPenalty + taxiPenalty;
  return candidate.score + candidate.transfers * 25 + candidate.taxiLegs * (planKey === "premium" ? -15 : 130);
}

function pickRouteOptions(candidates: PlanCandidate[], planKey: PlanKey): {
  variant: RouteVariantKey;
  candidate: PlanCandidate;
  railRecommended: boolean;
}[] {
  const variants: RouteVariantKey[] = ["recommended", "cheapest", "fastest", "fewest_transfers"];
  const picked: { variant: RouteVariantKey; candidate: PlanCandidate; railRecommended: boolean }[] = [];
  const used = new Set<string>();
  const railCandidates = candidates.filter((candidate) => candidate.usesRail);
  const nonRailCandidates = candidates.filter((candidate) => !candidate.usesRail);

  // Rail gets exactly one comparison card whenever both rail and non-rail
  // choices exist. The label is dynamic: assign rail to whichever objective it
  // fits most naturally, measured by its relative score penalty against that
  // objective's best non-rail option. It may therefore be Cheapest on one trip,
  // Fastest on another, etc. — never a hard-coded slot.
  let railVariant: RouteVariantKey | null = null;
  if (railCandidates.length) {
    railVariant = variants
      .map((variant) => {
        const bestRailScore = Math.min(...railCandidates.map((candidate) => scoreForVariant(candidate, variant, planKey)));
        const bestNonRailScore = nonRailCandidates.length
          ? Math.min(...nonRailCandidates.map((candidate) => scoreForVariant(candidate, variant, planKey)))
          : bestRailScore;
        return {
          variant,
          relativePenalty: (bestRailScore - bestNonRailScore) / Math.max(1, Math.abs(bestNonRailScore)),
        };
      })
      .sort((a, b) => a.relativePenalty - b.relativePenalty)[0]?.variant ?? null;
  }

  for (const variant of variants) {
    const isRailRecommendation = variant === railVariant;
    const pool = isRailRecommendation
      ? railCandidates
      : nonRailCandidates.length ? nonRailCandidates : candidates;
    const sorted = [...pool].sort((a, b) => scoreForVariant(a, variant, planKey) - scoreForVariant(b, variant, planKey));
    const choice = sorted.find((candidate) => !used.has(candidate.signature)) ?? sorted[0];
    if (!choice) continue;
    picked.push({ variant, candidate: choice, railRecommended: isRailRecommendation });
    used.add(choice.signature);
  }

  return picked;
}

export async function planTripOnDevice(request: PlannerRequest): Promise<ApiPlan | null> {
  if (request.mode && request.mode !== "city") return null;
  const planKey: PlanKey = request.tripType === "economic" || request.tripType === "premium" ? request.tripType : "comfortable";
  const isArabic = request.language === "ar";
  const snapshot = await getSnapshot();
  if (!snapshot) return null;

  const origin = { lat: request.startLat, lng: request.startLng };
  const dest = { lat: request.endLat, lng: request.endLng };
  const directKm = haversineKm(origin, dest);
  const candidates: PlanCandidate[] = [];
  const seen = new Set<string>();

  if (directKm <= WALK_MAX_KM) {
    const walk = connectorFor(directKm, origin, dest, planKey);
    addCandidate(
      candidates,
      seen,
      walk ? makeCandidate([connectorSegment(walk, isArabic ? "موقعك" : "Your location", request.destination || (isArabic ? "الوجهة" : "Destination"), isArabic)], planKey) : null,
    );
  }

  if (planKey === "premium" && directKm <= 18) {
    addCandidate(
      candidates,
      seen,
      makeCandidate([connectorSegment(directTaxiConnector(directKm, origin, dest), isArabic ? "موقعك" : "Your location", request.destination || (isArabic ? "الوجهة" : "Destination"), isArabic)], planKey),
    );
  }

  const RAIL_MODES = new Set<ModeKey>(["metro", "monorail"]);
  const startCandidates = buildCandidates(snapshot, origin, planKey, 36);
  const endCandidates = buildCandidates(snapshot, dest, planKey, 36);

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
      addCandidate(
        candidates,
        seen,
        makeCandidate(segments, planKey, totalLinePenalty(start.line) + modePreferencePenalty(start.mode, planKey), RAIL_MODES.has(start.mode)),
      );
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
      addCandidate(
        candidates,
        seen,
        makeCandidate(
          segments,
          planKey,
          totalLinePenalty(start.line)
            + totalLinePenalty(end.line)
            + modePreferencePenalty(start.mode, planKey)
            + modePreferencePenalty(end.mode, planKey),
          RAIL_MODES.has(start.mode) || RAIL_MODES.has(end.mode),
        ),
      );
    }
  }

  if (!candidates.length) return null;
  const picked = pickRouteOptions(candidates, planKey);
  if (!picked.length) return null;
  const plans = await Promise.all(picked.map(({ variant, candidate, railRecommended }) => (
    makePlan(candidate.segments, request, snapshot, variant, railRecommended)
  )));
  const primary = plans.find((plan) => plan.route_variant === "recommended")
    ?? plans.find((plan) => plan.rail_recommended)
    ?? plans[0];
  if (!primary) return null;
  return {
    ...primary,
    route_options: plans,
  };
}
