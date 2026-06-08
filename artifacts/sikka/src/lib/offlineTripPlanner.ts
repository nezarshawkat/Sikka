type LngLat = [number, number];
type Coord = { lat: number; lng: number };
type PlanKey = "economic" | "comfortable" | "premium";
type ModeKey = "metro" | "monorail" | "train" | "bus" | "serfis" | "microbus" | "taxi" | "tuktuk" | "walk";

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

const API_ORIGIN = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
const API_BASE = `${API_ORIGIN}/api`;
const SNAPSHOT_DB = "sikka-offline";
const SNAPSHOT_STORE = "snapshots";
const SNAPSHOT_KEY = "latest";
const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_REFRESH_MS = 10 * 60 * 1000;
const WALK_MAX_KM = 0.8;
const WALK_SPEED_KMH = 4.5;
const WALK_DETOUR = 1.3;
const FARE_MARKUP = 1.25;

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
  if (planKey === "economic") return new Set(["metro", "monorail", "train", "bus", "serfis", "microbus"]);
  if (planKey === "comfortable") return new Set(["metro", "monorail", "train", "bus", "serfis"]);
  return new Set(["metro", "monorail", "train", "bus", "serfis", "microbus"]);
}

function haversineKm(a: Coord, b: Coord): number {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
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

function lineFare(type: OfflineType, line: OfflineLine, km: number): number {
  if (type.pricePerKmEgp > 0) return Math.round((type.basePriceEgp + type.pricePerKmEgp * km) * FARE_MARKUP);
  return Math.round((line.priceEgp || type.basePriceEgp || 5) * FARE_MARKUP);
}

function waitMinutes(line: OfflineLine, mode: ModeKey): number {
  const defaults: Record<ModeKey, number> = { metro: 6, monorail: 8, train: 30, bus: 18, serfis: 10, microbus: 10, taxi: 6, tuktuk: 5, walk: 0 };
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
  return totalCost * costWeight + totalTime * timeWeight + transfers * 15;
}

function makePlan(segments: ApiSegment[], request: PlannerRequest, snapshot: OfflineSnapshot): ApiPlan {
  const planKey: PlanKey = request.tripType === "economic" || request.tripType === "premium" ? request.tripType : "comfortable";
  const isArabic = request.language === "ar";
  const enrichedSegments = attachAlternatives(snapshot, segments, planKey, isArabic);
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

async function fetchSnapshot(): Promise<OfflineSnapshot | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 6000);
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

async function getSnapshot(): Promise<OfflineSnapshot | null> {
  const cached = await readCachedSnapshot().catch(() => null);
  if (!cached || Date.now() - cached.savedAt > SNAPSHOT_REFRESH_MS) {
    const fresh = await fetchSnapshot();
    if (fresh) return fresh;
  }
  return cached?.snapshot ?? null;
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
  candidates.sort((a, b) => a.closest.distanceKm - b.closest.distanceKm);
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
  if (request.mode && request.mode !== "city") return null;
  const planKey: PlanKey = request.tripType === "economic" || request.tripType === "premium" ? request.tripType : "comfortable";
  const isArabic = request.language === "ar";
  const snapshot = await getSnapshot();
  if (!snapshot) return null;

  const origin = { lat: request.startLat, lng: request.startLng };
  const dest = { lat: request.endLat, lng: request.endLng };
  const directKm = haversineKm(origin, dest);

  if (directKm <= WALK_MAX_KM) {
    const walk = connectorFor(directKm, origin, dest, planKey);
    if (walk) return makePlan([connectorSegment(walk, isArabic ? "موقعك" : "Your location", request.destination || (isArabic ? "الوجهة" : "Destination"), isArabic)], request, snapshot);
  }

  if (planKey === "premium" && directKm <= 18) {
    const taxi = connectorFor(directKm, origin, dest, planKey);
    if (taxi) return makePlan([connectorSegment(taxi, isArabic ? "موقعك" : "Your location", request.destination || (isArabic ? "الوجهة" : "Destination"), isArabic)], request, snapshot);
  }

  const startCandidates = buildCandidates(snapshot, origin, planKey, 36);
  const endCandidates = buildCandidates(snapshot, dest, planKey, 36);
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
      const score = scoreSegments(segments, planKey);
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
      const score = scoreSegments(segments, planKey);
      if (!best || score < best.score) best = { score, segments };
    }
  }

  return best ? makePlan(best.segments, request, snapshot) : null;
}
