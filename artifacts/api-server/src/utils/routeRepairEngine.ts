import { and, desc, eq } from "drizzle-orm";
import {
  db,
  routeGeometryVersionsTable,
  routeRepairAnchorsTable,
  transitLinesTable,
  type RouteGeometryVersion,
  type RoutePathGeoJson,
  type TransitLine,
  type TransportType,
} from "@workspace/db";
import { invalidateGraph } from "../engine/graph";

export type LngLat = [number, number];

export interface RepairGuard {
  ok: boolean;
  reason?: string;
}

export interface RepairAnchorInput {
  id?: string;
  sequence?: number;
  direction?: string;
  name?: string;
  nameAr?: string | null;
  lat: number;
  lng: number;
  source?: string;
  required?: boolean;
  confidenceScore?: number;
  anchorType?: string;
}

export interface RepairAnchor {
  id?: string;
  sequence: number;
  direction: string;
  name: string;
  nameAr?: string | null;
  point: LngLat;
  source: string;
  required: boolean;
  confidenceScore: number;
  anchorType: string;
}

export interface BadSection {
  startIndex: number;
  endIndex: number;
  reason: string;
  distanceKm?: number;
}

export interface RepairMetrics {
  candidateSource: string;
  pointCount: number;
  lengthKm: number;
  straightLineKm: number;
  lengthRatio: number;
  maxStepKm: number;
  endpointStartDistanceKm: number | null;
  endpointEndDistanceKm: number | null;
  anchorHitRate: number;
  maxAnchorDistanceKm: number | null;
  anchorOrderMonotonic: boolean;
  backtrackRatio: number;
  selfIntersectionCount: number;
  repeatedSegmentRatio: number;
  existingPathSimilarity: number | null;
  osmRelationSimilarity: number | null;
  gpsSimilarity: number | null;
  failedSegmentCount: number;
  uncertainSections: BadSection[];
  manualAnchorMisses: number;
  governorateBoundsOk: boolean;
  modeCompatibilityOk: boolean;
  weldApplied: boolean;
  weldDistanceMeters: number | null;
  weldDirection: string | null;
  boundaryTrustSource: string | null;
  stopRouteAlignmentWarnings: string[];
  warnings: string[];
  confidenceLevel: "high" | "medium" | "low";
  publishable: boolean;
}

export interface RepairCandidateResult {
  status: "skipped" | "candidate" | "needs_review" | "failed";
  reason?: string;
  geometry: RoutePathGeoJson | null;
  anchors: RepairAnchor[];
  source: string;
  qualityScore: number;
  confidenceScore: number;
  confidenceLevel: "high" | "medium" | "low";
  publishable: boolean;
  metrics: RepairMetrics | null;
  evidence: Record<string, unknown>;
  warnings: string[];
}

export interface StoredRepairResult extends RepairCandidateResult {
  versionId?: string;
  version?: number;
  accepted?: boolean;
}

interface RouterAttempt {
  ok: boolean;
  geometry: LngLat[] | null;
  mode: "valhalla_trace" | "valhalla_route";
  warning?: string;
  controlAnchors?: RepairAnchor[];
}

const EGYPT_BOUNDS = {
  minLng: 24.5,
  maxLng: 37.8,
  minLat: 21.3,
  maxLat: 32.2,
};

const FIXED_GUIDEWAY_TERMS = [
  "metro",
  "monorail",
  "lrt",
  "tram",
  "train",
  "rail",
  "subway",
];

const ROAD_TERMS = [
  "bus",
  "microbus",
  "serfis",
  "service",
  "minibus",
];

const TRUSTED_DATA_SOURCES = [
  "gtfs",
  "discovery",
  "gps",
  "rider_gps",
  "rider-confirmed",
  "rider_confirmed",
  "admin_verified",
  "admin-verified",
];

const ROUTER_TIMEOUT_MS = 25_000;
const VALHALLA_TRACE_MAX_POINTS = Math.max(2, Number(process.env.VALHALLA_TRACE_MAX_POINTS || 160));
const VALHALLA_ROUTE_MAX_LOCATIONS = Math.max(2, Number(process.env.VALHALLA_ROUTE_MAX_LOCATIONS || 20));

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function haversineKm(a: LngLat, b: LngLat): number {
  const r = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function isInsideEgypt(point: LngLat): boolean {
  return (
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1]) &&
    point[0] >= EGYPT_BOUNDS.minLng &&
    point[0] <= EGYPT_BOUNDS.maxLng &&
    point[1] >= EGYPT_BOUNDS.minLat &&
    point[1] <= EGYPT_BOUNDS.maxLat
  );
}

function totalLengthKm(points: LngLat[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += haversineKm(points[i - 1], points[i]);
  return sum;
}

function densifyRoute(points: LngLat[], maxSpacingKm = 0.45): LngLat[] {
  if (points.length < 2) return points;
  const dense: LngLat[] = [points[0]];
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    const distance = haversineKm(from, to);
    const sections = Math.max(1, Math.ceil(distance / maxSpacingKm));
    for (let section = 1; section <= sections; section++) {
      const ratio = section / sections;
      dense.push([
        from[0] + (to[0] - from[0]) * ratio,
        from[1] + (to[1] - from[1]) * ratio,
      ]);
    }
  }
  return dense;
}

function maxStepKm(points: LngLat[]): number {
  let max = 0;
  for (let i = 1; i < points.length; i++) max = Math.max(max, haversineKm(points[i - 1], points[i]));
  return max;
}

function getTransportName(type: Pick<TransportType, "nameEn" | "nameAr"> | null | undefined): string {
  return `${type?.nameEn ?? ""} ${type?.nameAr ?? ""}`.trim();
}

function isFixedGuideway(typeName: string, line: Pick<TransitLine, "lineNumber" | "nameEn" | "nameAr">): boolean {
  const haystack = normalize(`${typeName} ${line.lineNumber ?? ""} ${line.nameEn ?? ""} ${line.nameAr ?? ""}`);
  return FIXED_GUIDEWAY_TERMS.some((term) => haystack.includes(term));
}

function isRoadMode(typeName: string): boolean {
  const haystack = normalize(typeName);
  return ROAD_TERMS.some((term) => haystack.includes(term));
}

export function canRepairRoadRoute(
  line: TransitLine,
  transportType: Pick<TransportType, "nameEn" | "nameAr"> | null | undefined,
): RepairGuard {
  const source = normalize(line.dataSource);
  const typeName = getTransportName(transportType);

  if (!line.isActive) return { ok: false, reason: "inactive_route" };
  if (line.geometryLocked) return { ok: false, reason: "geometry_locked" };
  if (line.routeStatus === "inactive") return { ok: false, reason: "inactive_route" };
  if (TRUSTED_DATA_SOURCES.includes(source)) return { ok: false, reason: `protected_${source}` };
  if (isFixedGuideway(typeName, line)) return { ok: false, reason: "protected_fixed_guideway" };
  if (!isRoadMode(typeName)) return { ok: false, reason: "not_a_road_route" };
  if (line.sourcePriority >= 80) return { ok: false, reason: "trusted_high_source_priority" };
  if (line.sourcePriority >= 50 && source.includes("admin")) return { ok: false, reason: "trusted_admin_source" };

  return { ok: true };
}

function cleanRoutePath(points: LngLat[]): { points: LngLat[]; warnings: string[]; badSections: BadSection[] } {
  const warnings: string[] = [];
  const badSections: BadSection[] = [];
  const valid: LngLat[] = [];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!Array.isArray(p) || !isInsideEgypt(p)) {
      warnings.push("dropped_invalid_or_outside_egypt_coordinate");
      continue;
    }
    const previous = valid[valid.length - 1];
    if (previous && haversineKm(previous, p) < 0.005) {
      warnings.push("dropped_duplicate_coordinate");
      continue;
    }
    valid.push(p);
  }

  const cleaned: LngLat[] = [];
  for (let i = 0; i < valid.length; i++) {
    const p = valid[i];
    const previous = cleaned[cleaned.length - 1];
    if (previous) {
      const step = haversineKm(previous, p);
      if (step > 2.5) {
        badSections.push({ startIndex: Math.max(0, i - 1), endIndex: i, reason: "huge_jump", distanceKm: step });
        warnings.push("huge_jump_detected");
        // Keep both sides as evidence, but avoid dense sampling around this bad edge later.
      }
    }
    cleaned.push(p);
  }

  const repeated = repeatedSegmentRatio(cleaned);
  if (repeated > 0.18) warnings.push("repeated_geometry_sections");

  const backtrack = backtrackRatio(cleaned);
  if (backtrack > 0.32) warnings.push("strong_backtracking_detected");

  return { points: cleaned, warnings: unique(warnings), badSections };
}

function sampleEvery(points: LngLat[], maxPoints: number): LngLat[] {
  if (points.length <= maxPoints) return points;
  const sampled: LngLat[] = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    sampled.push(points[Math.round(i * step)]);
  }
  return dedupeNearby(sampled, 0.02);
}

function bearingDeg(a: LngLat, b: LngLat): number {
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function angleDeltaDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function isInBadSection(index: number, badSections: BadSection[]): boolean {
  return badSections.some((section) => index >= section.startIndex && index <= section.endIndex);
}

function sampleAnchorsFromPath(points: LngLat[], badSections: BadSection[]): RepairAnchor[] {
  if (points.length < 2) return [];
  const anchors: RepairAnchor[] = [];
  const length = totalLengthKm(points);
  const targetSpacingKm = length > 18 ? 2.2 : length > 8 ? 1.4 : 0.8;
  let distanceSinceAnchor = 0;
  let lastAnchorIndex = 0;

  anchors.push({
    sequence: 0,
    direction: "forward",
    name: "Route start",
    point: points[0],
    source: "route_path_derived",
    required: true,
    confidenceScore: 0.85,
    anchorType: "start",
  });

  for (let i = 2; i < points.length - 2; i++) {
    const previous = points[i - 1];
    const current = points[i];
    const next = points[i + 1];
    distanceSinceAnchor += haversineKm(points[i - 1], current);
    if (isInBadSection(i, badSections)) continue;

    const turn = angleDeltaDeg(bearingDeg(previous, current), bearingDeg(current, next));
    const shouldAddTurn = turn >= 38 && haversineKm(points[lastAnchorIndex], current) >= 0.45;
    const shouldAddSpacing = distanceSinceAnchor >= targetSpacingKm;

    if (shouldAddTurn || shouldAddSpacing) {
      anchors.push({
        sequence: anchors.length,
        direction: "forward",
        name: shouldAddTurn ? "Existing-path turn anchor" : "Existing-path corridor anchor",
        point: current,
        source: "existing_path_sample",
        required: shouldAddTurn,
        confidenceScore: shouldAddTurn ? 0.8 : 0.68,
        anchorType: shouldAddTurn ? "turn" : "corridor",
      });
      distanceSinceAnchor = 0;
      lastAnchorIndex = i;
    }
  }

  anchors.push({
    sequence: anchors.length,
    direction: "forward",
    name: "Route end",
    point: points[points.length - 1],
    source: "route_path_derived",
    required: true,
    confidenceScore: 0.85,
    anchorType: "end",
  });

  return anchors.map((anchor, index) => ({ ...anchor, sequence: index }));
}

function anchorsFromCoordinateStops(line: TransitLine): RepairAnchor[] {
  const stops = Array.isArray(line.stops) ? line.stops : [];
  const anchors: RepairAnchor[] = [];
  for (const stop of stops) {
    const point: LngLat = [Number(stop.lng), Number(stop.lat)];
    if (!isInsideEgypt(point)) continue;
    anchors.push({
      sequence: anchors.length,
      direction: "forward",
      name: stop.name || "Route stop",
      point,
      source: "station_seed",
      required: false,
      confidenceScore: 0.64,
      anchorType: "boarding_area",
    });
  }
  return anchors;
}

function dedupeNearby(points: LngLat[], minDistanceKm: number): LngLat[] {
  const out: LngLat[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (!last || haversineKm(last, point) >= minDistanceKm) out.push(point);
  }
  return out;
}

function dedupeAnchors(anchors: RepairAnchor[]): RepairAnchor[] {
  const sorted = [...anchors].sort((a, b) => a.sequence - b.sequence);
  const out: RepairAnchor[] = [];
  for (const anchor of sorted) {
    if (!isInsideEgypt(anchor.point)) continue;
    const previous = out[out.length - 1];
    if (previous && haversineKm(previous.point, anchor.point) < 0.08) {
      // Keep the stronger of two near-duplicate anchors, but preserve sequence.
      if (anchor.required && !previous.required) out[out.length - 1] = { ...anchor, sequence: previous.sequence };
      continue;
    }
    out.push({ ...anchor, sequence: out.length });
  }
  return out;
}

function normalizeManualAnchors(inputs: RepairAnchorInput[]): RepairAnchor[] {
  return inputs
    .map((input, index) => ({
      id: input.id,
      sequence: Number.isFinite(input.sequence) ? Number(input.sequence) : index,
      direction: input.direction || "forward",
      name: input.name || `Anchor ${index + 1}`,
      nameAr: input.nameAr ?? null,
      point: [Number(input.lng), Number(input.lat)] as LngLat,
      source: input.source || "manual_admin",
      required: input.required ?? true,
      confidenceScore: input.confidenceScore ?? 0.92,
      anchorType: input.anchorType || (index === 0 ? "start" : "corridor"),
    }))
    .filter((anchor) => isInsideEgypt(anchor.point))
    .sort((a, b) => a.sequence - b.sequence)
    .map((anchor, index, arr) => ({
      ...anchor,
      sequence: index,
      anchorType: index === 0 ? "start" : index === arr.length - 1 ? "end" : anchor.anchorType,
    }));
}

function valhallaBaseUrl(): string | null {
  const configured = process.env.VALHALLA_URL || "http://localhost:8002";
  const base = configured.trim().replace(/\/+$/, "");
  if (!base) return null;
  if (!base.includes("localhost") && !base.includes("127.0.0.1") && process.env.ALLOW_PUBLIC_ROUTING_SERVICES !== "true") {
    return null;
  }
  return base;
}

export async function checkRouteRepairRouter(): Promise<{
  valhallaUrl: string | null;
  allowPublicRoutingServices: boolean;
  reachable: boolean;
  warning: string | null;
}> {
  const base = valhallaBaseUrl();
  if (!base) {
    return {
      valhallaUrl: null,
      allowPublicRoutingServices: process.env.ALLOW_PUBLIC_ROUTING_SERVICES === "true",
      reachable: false,
      warning: "VALHALLA_URL is not local and ALLOW_PUBLIC_ROUTING_SERVICES is not true",
    };
  }

  try {
    const response = await fetch(`${base}/status`, { signal: AbortSignal.timeout(3_000) });
    return {
      valhallaUrl: base,
      allowPublicRoutingServices: process.env.ALLOW_PUBLIC_ROUTING_SERVICES === "true",
      reachable: response.ok,
      warning: response.ok ? null : `Valhalla status returned ${response.status}`,
    };
  } catch {
    return {
      valhallaUrl: base,
      allowPublicRoutingServices: process.env.ALLOW_PUBLIC_ROUTING_SERVICES === "true",
      reachable: false,
      warning: "local_valhalla_unreachable",
    };
  }
}

function decodePolyline6(encoded: string): LngLat[] {
  const coordinates: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const factor = 1e6;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    coordinates.push([lng / factor, lat / factor]);
  }

  return coordinates.filter(isInsideEgypt);
}

function costingForRoute(typeName: string): { costing: string; costing_options: Record<string, unknown> } {
  const normalized = normalize(typeName);
  if (normalized.includes("microbus") || normalized.includes("serfis")) {
    return {
      costing: "auto",
      costing_options: {
        auto: {
          use_highways: 0.35,
          use_tolls: 0,
          use_living_streets: 0.18,
          use_tracks: 0.05,
        },
      },
    };
  }
  return {
    costing: "auto",
    costing_options: {
      auto: {
        use_highways: 0.55,
        use_tolls: 0,
        use_living_streets: 0.05,
        use_tracks: 0,
      },
    },
  };
}

async function postValhalla(path: string, body: Record<string, unknown>): Promise<unknown | null> {
  const base = valhallaBaseUrl();
  if (!base) return null;
  try {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function extractValhallaShape(data: unknown): LngLat[] | null {
  const trip = (data as { trip?: { legs?: Array<{ shape?: string }>; shape?: string } } | null)?.trip;
  const shapes = [
    ...(trip?.legs ?? []).map((leg) => leg.shape).filter((shape): shape is string => Boolean(shape)),
    trip?.shape,
  ].filter((shape): shape is string => Boolean(shape));
  const decoded = shapes.flatMap((shape) => decodePolyline6(shape));
  return decoded.length >= 2 ? dedupeNearby(decoded, 0.002) : null;
}

async function valhallaTraceRoute(points: LngLat[], typeName: string): Promise<RouterAttempt> {
  const sampled = sampleEvery(points, VALHALLA_TRACE_MAX_POINTS);
  if (sampled.length < 2) {
    return { ok: false, geometry: null, mode: "valhalla_trace", warning: "too_few_trace_points" };
  }
  const costing = costingForRoute(typeName);
  const data = await postValhalla("/trace_route", {
    shape: sampled.map((point) => ({ lon: point[0], lat: point[1] })),
    shape_match: "map_snap",
    search_radius: 80,
    gps_accuracy: 30,
    ...costing,
    directions_options: { units: "kilometers" },
    shape_format: "polyline6",
  });
  const geometry = extractValhallaShape(data);
  if (!geometry) return { ok: false, geometry: null, mode: "valhalla_trace", warning: "valhalla_trace_failed" };
  return { ok: true, geometry, mode: "valhalla_trace" };
}

async function valhallaRouteThroughAnchors(anchors: RepairAnchor[], typeName: string): Promise<RouterAttempt> {
  const deduped = dedupeAnchors(anchors);
  const usable = deduped.length <= VALHALLA_ROUTE_MAX_LOCATIONS
    ? deduped
    : Array.from({ length: VALHALLA_ROUTE_MAX_LOCATIONS }, (_, index) =>
        deduped[Math.round((index * (deduped.length - 1)) / (VALHALLA_ROUTE_MAX_LOCATIONS - 1))],
      );
  if (usable.length < 2) {
    return { ok: false, geometry: null, mode: "valhalla_route", warning: "too_few_anchors" };
  }
  const costing = costingForRoute(typeName);
  const data = await postValhalla("/route", {
    locations: usable.map((anchor, index) => ({
      lon: anchor.point[0],
      lat: anchor.point[1],
      type: index === 0 || index === usable.length - 1
        ? "break"
        : anchor.required
          ? "break_through"
          : "through",
    })),
    ...costing,
    directions_options: { units: "kilometers" },
    shape_format: "polyline6",
  });
  const geometry = extractValhallaShape(data);
  if (!geometry) return { ok: false, geometry: null, mode: "valhalla_route", warning: "valhalla_route_failed" };
  return { ok: true, geometry, mode: "valhalla_route", controlAnchors: usable };
}

function nearestDistanceToPathKm(point: LngLat, path: LngLat[]): { distanceKm: number; index: number } {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestIndex = 0;
  for (let i = 0; i < path.length; i++) {
    const distance = haversineKm(point, path[i]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return { distanceKm: bestDistance, index: bestIndex };
}

function anchorMetrics(anchors: RepairAnchor[], path: LngLat[]): {
  hitRate: number;
  maxDistanceKm: number | null;
  orderMonotonic: boolean;
  manualAnchorMisses: number;
} {
  const required = anchors.filter((anchor) => anchor.required);
  if (!required.length) return { hitRate: 1, maxDistanceKm: null, orderMonotonic: true, manualAnchorMisses: 0 };
  const projections = required.map((anchor) => ({ anchor, projection: nearestDistanceToPathKm(anchor.point, path) }));
  const hits = projections.filter((item) => item.projection.distanceKm <= 0.18).length;
  let lastIndex = -1;
  let orderMonotonic = true;
  for (const item of projections) {
    if (item.projection.index + 4 < lastIndex) orderMonotonic = false;
    lastIndex = Math.max(lastIndex, item.projection.index);
  }
  const manualAnchorMisses = projections.filter((item) =>
    item.anchor.source === "manual_admin" && item.projection.distanceKm > 0.08,
  ).length;
  return {
    hitRate: hits / required.length,
    maxDistanceKm: projections.reduce((max, item) => Math.max(max, item.projection.distanceKm), 0),
    orderMonotonic,
    manualAnchorMisses,
  };
}

function backtrackRatio(points: LngLat[]): number {
  if (points.length < 3) return 0;
  const first = points[0];
  const last = points[points.length - 1];
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const spanSq = dx * dx + dy * dy;
  if (spanSq === 0) return 0;
  const projection = (p: LngLat) => ((p[0] - first[0]) * dx + (p[1] - first[1]) * dy) / spanSq;
  let total = 0;
  let backward = 0;
  let previousProjection = projection(points[0]);
  for (let i = 1; i < points.length; i++) {
    const currentProjection = projection(points[i]);
    const step = haversineKm(points[i - 1], points[i]);
    total += step;
    if (currentProjection < previousProjection - 0.03) backward += step;
    previousProjection = Math.max(previousProjection, currentProjection);
  }
  return total > 0 ? backward / total : 0;
}

function repeatedSegmentRatio(points: LngLat[]): number {
  if (points.length < 4) return 0;
  const seen = new Map<string, number>();
  let repeated = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const keyA = `${Math.round(a[0] * 8000)},${Math.round(a[1] * 8000)}`;
    const keyB = `${Math.round(b[0] * 8000)},${Math.round(b[1] * 8000)}`;
    const key = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
    const count = seen.get(key) ?? 0;
    if (count > 0) repeated++;
    seen.set(key, count + 1);
  }
  return repeated / Math.max(1, points.length - 1);
}

function orientation(a: LngLat, b: LngLat, c: LngLat): number {
  return (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
}

function segmentsIntersect(a: LngLat, b: LngLat, c: LngLat, d: LngLat): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function selfIntersectionCount(points: LngLat[]): number {
  if (points.length > 800) {
    return selfIntersectionCount(sampleEvery(points, 800));
  }
  let count = 0;
  for (let i = 1; i < points.length; i++) {
    for (let j = i + 3; j < points.length; j++) {
      if (segmentsIntersect(points[i - 1], points[i], points[j - 1], points[j])) count++;
      if (count > 50) return count;
    }
  }
  return count;
}

function existingPathSimilarity(candidate: LngLat[], oldPath: LngLat[] | null): number | null {
  if (!oldPath || oldPath.length < 2 || candidate.length < 2) return null;
  const sampled = sampleEvery(candidate, 80);
  const avgDistance = sampled.reduce((sum, point) => sum + nearestDistanceToPathKm(point, oldPath).distanceKm, 0) / sampled.length;
  return Math.max(0, Math.min(1, 1 - avgDistance / 1.2));
}

function classifyCandidate(metrics: Omit<RepairMetrics, "confidenceLevel" | "publishable">): {
  confidenceLevel: "high" | "medium" | "low";
  publishable: boolean;
  qualityScore: number;
  confidenceScore: number;
  warnings: string[];
} {
  const warnings = unique([...metrics.warnings]);
  const loopLikeRoute =
    metrics.straightLineKm < 5 &&
    ((metrics.lengthRatio > 4 && metrics.lengthKm > 4) ||
      (metrics.straightLineKm < 0.3 && metrics.lengthKm > 1)) &&
    metrics.anchorHitRate >= 0.8;
  const hardReject =
    metrics.pointCount < 2 ||
    !metrics.governorateBoundsOk ||
    !metrics.modeCompatibilityOk ||
    metrics.maxStepKm > 1.4 ||
    metrics.failedSegmentCount > 0 ||
    metrics.manualAnchorMisses > 0 ||
    (!loopLikeRoute && !metrics.anchorOrderMonotonic) ||
    metrics.anchorHitRate < 0.65 ||
    (!loopLikeRoute && metrics.lengthRatio > 5.5) ||
    metrics.repeatedSegmentRatio > 0.35 ||
    (!loopLikeRoute && metrics.backtrackRatio > 0.48) ||
    (metrics.endpointStartDistanceKm !== null && metrics.endpointStartDistanceKm > 1.5) ||
    (metrics.endpointEndDistanceKm !== null && metrics.endpointEndDistanceKm > 1.5);

  if (hardReject) {
    warnings.push("hard_quality_reject");
    return {
      confidenceLevel: "low",
      publishable: false,
      qualityScore: 0.25,
      confidenceScore: 0.35,
      warnings: unique(warnings),
    };
  }

  let score = 0.72;
  if (metrics.maxStepKm <= 0.25) score += 0.08;
  if (metrics.anchorHitRate >= 0.92) score += 0.08;
  if (metrics.lengthRatio <= 3.2 || metrics.straightLineKm < 0.3) score += 0.05;
  if (metrics.existingPathSimilarity !== null && metrics.existingPathSimilarity >= 0.58) score += 0.05;
  if (metrics.backtrackRatio <= 0.18) score += 0.04;
  if (metrics.selfIntersectionCount === 0) score += 0.03;
  if (warnings.length) score -= Math.min(0.18, warnings.length * 0.035);

  const qualityScore = Math.max(0.1, Math.min(0.98, score));
  const high =
    qualityScore >= 0.82 &&
    metrics.anchorHitRate >= 0.85 &&
    metrics.maxStepKm <= 0.55 &&
    metrics.lengthRatio <= 4.2 &&
    metrics.backtrackRatio <= 0.28 &&
    (metrics.existingPathSimilarity === null || metrics.existingPathSimilarity >= 0.42);

  return {
    confidenceLevel: high ? "high" : "medium",
    publishable: high,
    qualityScore,
    confidenceScore: high ? Math.max(0.82, qualityScore) : Math.min(0.79, qualityScore),
    warnings: unique(warnings),
  };
}

function buildMetrics(
  source: string,
  candidate: LngLat[],
  anchors: RepairAnchor[],
  oldPath: LngLat[] | null,
  warnings: string[],
  badSections: BadSection[],
  modeCompatibilityOk: boolean,
): { metrics: RepairMetrics; qualityScore: number; confidenceScore: number } {
  const first = candidate[0];
  const last = candidate[candidate.length - 1];
  const straight = candidate.length >= 2 ? haversineKm(first, last) : 0;
  const length = totalLengthKm(candidate);
  const anchorsSummary = anchorMetrics(anchors, candidate);
  const baseMetrics: Omit<RepairMetrics, "confidenceLevel" | "publishable"> = {
    candidateSource: source,
    pointCount: candidate.length,
    lengthKm: Number(length.toFixed(3)),
    straightLineKm: Number(straight.toFixed(3)),
    lengthRatio: straight > 0.05 ? Number((length / straight).toFixed(3)) : 1,
    maxStepKm: Number(maxStepKm(candidate).toFixed(3)),
    endpointStartDistanceKm: oldPath?.[0] ? Number(haversineKm(oldPath[0], first).toFixed(3)) : null,
    endpointEndDistanceKm: oldPath?.[oldPath.length - 1] ? Number(haversineKm(oldPath[oldPath.length - 1], last).toFixed(3)) : null,
    anchorHitRate: Number(anchorsSummary.hitRate.toFixed(3)),
    maxAnchorDistanceKm: anchorsSummary.maxDistanceKm === null ? null : Number(anchorsSummary.maxDistanceKm.toFixed(3)),
    anchorOrderMonotonic: anchorsSummary.orderMonotonic,
    backtrackRatio: Number(backtrackRatio(candidate).toFixed(3)),
    selfIntersectionCount: selfIntersectionCount(candidate),
    repeatedSegmentRatio: Number(repeatedSegmentRatio(candidate).toFixed(3)),
    existingPathSimilarity: existingPathSimilarity(candidate, oldPath),
    osmRelationSimilarity: null,
    gpsSimilarity: null,
    failedSegmentCount: 0,
    uncertainSections: badSections,
    manualAnchorMisses: anchorsSummary.manualAnchorMisses,
    governorateBoundsOk: candidate.every(isInsideEgypt),
    modeCompatibilityOk,
    weldApplied: false,
    weldDistanceMeters: null,
    weldDirection: null,
    boundaryTrustSource: null,
    stopRouteAlignmentWarnings: [],
    warnings: unique(warnings),
  };
  const classified = classifyCandidate(baseMetrics);
  const metrics: RepairMetrics = {
    ...baseMetrics,
    warnings: classified.warnings,
    confidenceLevel: classified.confidenceLevel,
    publishable: classified.publishable,
  };
  return {
    metrics,
    qualityScore: classified.qualityScore,
    confidenceScore: classified.confidenceScore,
  };
}

function oldPathCoords(line: TransitLine): LngLat[] | null {
  const coordinates = line.routePath?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  return coordinates as LngLat[];
}

function buildEvidence(line: TransitLine, anchors: RepairAnchor[], extra: Record<string, unknown>): Record<string, unknown> {
  return {
    lineId: line.id,
    lineNumber: line.lineNumber,
    fromArea: line.fromArea,
    toArea: line.toArea,
    viaStops: line.viaStops ?? [],
    dataSource: line.dataSource,
    sourcePriority: line.sourcePriority,
    anchorCount: anchors.length,
    anchors: anchors.map((anchor) => ({
      sequence: anchor.sequence,
      name: anchor.name,
      source: anchor.source,
      required: anchor.required,
      confidenceScore: anchor.confidenceScore,
      anchorType: anchor.anchorType,
      lat: anchor.point[1],
      lng: anchor.point[0],
    })),
    ...extra,
  };
}

export async function generateRepairCandidate(
  line: TransitLine,
  transportType: TransportType | null | undefined,
  options: { repairMode?: "existing_path" | "anchors" | "auto"; manualAnchors?: RepairAnchorInput[] } = {},
): Promise<RepairCandidateResult> {
  const guard = canRepairRoadRoute(line, transportType);
  if (!guard.ok) {
    return {
      status: "skipped",
      reason: guard.reason,
      geometry: null,
      anchors: [],
      source: "skipped",
      qualityScore: 0,
      confidenceScore: line.confidenceScore ?? 0,
      confidenceLevel: "low",
      publishable: false,
      metrics: null,
      evidence: { skipReason: guard.reason },
      warnings: [guard.reason ?? "skipped"],
    };
  }

  const typeName = getTransportName(transportType);
  const manualAnchors = normalizeManualAnchors(options.manualAnchors ?? []);
  const routeMode = options.repairMode ?? "auto";
  const original = oldPathCoords(line);
  const oldClean = original ? cleanRoutePath(original) : null;
  const oldUsable = oldClean?.points ?? null;
  const warnings = [...(oldClean?.warnings ?? [])];
  const badSections = oldClean?.badSections ?? [];

  let anchors = manualAnchors;
  if (anchors.length < 2 && routeMode !== "anchors" && oldUsable && oldUsable.length >= 2) {
    anchors = sampleAnchorsFromPath(oldUsable, badSections);
  }
  if (anchors.length < 2) {
    anchors = dedupeAnchors([...manualAnchors, ...anchorsFromCoordinateStops(line)]);
  }

  if (anchors.length < 2) {
    return {
      status: "needs_review",
      reason: "missing_coordinate_control_anchors",
      geometry: null,
      anchors,
      source: "none",
      qualityScore: 0.2,
      confidenceScore: 0.25,
      confidenceLevel: "low",
      publishable: false,
      metrics: null,
      evidence: buildEvidence(line, anchors, {
        reason: "No trusted coordinate path/stops/anchors available. Text viaStops are intentionally not used as truth.",
      }),
      warnings: unique([...warnings, "missing_coordinate_control_anchors"]),
    };
  }

  let attempt: RouterAttempt | null = null;
  if (routeMode !== "anchors" && oldUsable && oldUsable.length >= 2) {
    attempt = await valhallaTraceRoute(oldUsable, typeName);
    if (!attempt.ok) warnings.push(attempt.warning ?? "valhalla_trace_failed");
    if (attempt.ok && attempt.geometry) {
      const traceAnchors = anchorMetrics(anchors, attempt.geometry);
      const traceStartMissKm = haversineKm(anchors[0].point, attempt.geometry[0]);
      const traceEndMissKm = haversineKm(
        anchors[anchors.length - 1].point,
        attempt.geometry[attempt.geometry.length - 1],
      );
      const traceMissedControls =
        traceStartMissKm > 0.35 ||
        traceEndMissKm > 0.35 ||
        traceAnchors.hitRate < 0.6 ||
        (traceAnchors.maxDistanceKm ?? 0) > 1.2 ||
        !traceAnchors.orderMonotonic;
      if (traceMissedControls) {
        warnings.push("trace_incomplete_retrying_through_control_anchors");
        attempt = null;
      }
    }
  }

  if (!attempt?.ok) {
    attempt = await valhallaRouteThroughAnchors(anchors, typeName);
    if (!attempt.ok) warnings.push(attempt.warning ?? "valhalla_route_failed");
  }

  let candidate = attempt?.geometry ?? null;
  let source = attempt?.ok ? attempt.mode : "router_unavailable";

  if (!candidate && oldUsable && oldUsable.length >= 2 && valhallaBaseUrl()) {
    candidate = oldUsable;
    source = "existing_path_cleaned_unsnapped";
    warnings.push("router_failed_kept_cleaned_existing_path_for_review");
  }

  if (!candidate || candidate.length < 2) {
    return {
      status: "failed",
      reason: "router_unavailable_or_unroutable",
      geometry: null,
      anchors,
      source,
      qualityScore: 0.15,
      confidenceScore: 0.2,
      confidenceLevel: "low",
      publishable: false,
      metrics: null,
      evidence: buildEvidence(line, anchors, {
        router: valhallaBaseUrl() ? "configured_but_failed" : "local_router_not_available",
      }),
      warnings: unique([...warnings, "router_unavailable_or_unroutable"]),
    };
  }

  if (source === "valhalla_trace" || source === "valhalla_route") {
    candidate = densifyRoute(candidate);
  }

  const modeCompatibilityOk = !isFixedGuideway(typeName, line);
  const { metrics, qualityScore, confidenceScore } = buildMetrics(
    source,
    candidate,
    attempt?.controlAnchors ?? anchors,
    oldUsable,
    warnings,
    badSections,
    modeCompatibilityOk,
  );
  if (source === "existing_path_cleaned_unsnapped") {
    metrics.publishable = false;
    metrics.confidenceLevel = metrics.confidenceLevel === "low" ? "low" : "medium";
    metrics.warnings = unique([...metrics.warnings, "candidate_not_osm_snapped"]);
  }
  const geometry: RoutePathGeoJson = { type: "LineString", coordinates: candidate };
  const status = metrics.confidenceLevel === "low" ? "needs_review" : "candidate";

  return {
    status,
    geometry,
    anchors,
    source,
    qualityScore: source === "existing_path_cleaned_unsnapped" ? Math.min(qualityScore, 0.68) : qualityScore,
    confidenceScore: source === "existing_path_cleaned_unsnapped" ? Math.min(confidenceScore, 0.68) : confidenceScore,
    confidenceLevel: metrics.confidenceLevel,
    publishable: metrics.publishable,
    metrics,
    evidence: buildEvidence(line, anchors, {
      repairMode: routeMode,
      routerMode: source,
      originalPointCount: original?.length ?? 0,
      cleanedPointCount: oldUsable?.length ?? 0,
    }),
    warnings: metrics.warnings,
  };
}

async function nextGeometryVersion(transitLineId: string): Promise<number> {
  const [latest] = await db
    .select({ version: routeGeometryVersionsTable.version })
    .from(routeGeometryVersionsTable)
    .where(eq(routeGeometryVersionsTable.transitLineId, transitLineId))
    .orderBy(desc(routeGeometryVersionsTable.version))
    .limit(1);
  return (latest?.version ?? 0) + 1;
}

async function ensureLegacyGeometryVersion(line: TransitLine, createdBy: string | null | undefined): Promise<void> {
  if (!line.routePath?.coordinates?.length) return;
  const [existing] = await db
    .select({ id: routeGeometryVersionsTable.id })
    .from(routeGeometryVersionsTable)
    .where(and(
      eq(routeGeometryVersionsTable.transitLineId, line.id),
      eq(routeGeometryVersionsTable.source, "legacy_route_path"),
    ))
    .limit(1);
  if (existing) return;

  await db.insert(routeGeometryVersionsTable).values({
    transitLineId: line.id,
    version: await nextGeometryVersion(line.id),
    geometry: line.routePath,
    source: "legacy_route_path",
    status: "accepted",
    qualityScore: line.confidenceScore ?? 0.6,
    confidenceScore: line.confidenceScore ?? 0.6,
    metrics: { legacy: true },
    evidence: { importedFromTransitLinesRoutePath: true },
    createdBy: createdBy ?? null,
    acceptedAt: line.verifiedAt ?? new Date(),
  });
}

export async function persistRepairAnchors(
  transitLineId: string,
  anchors: RepairAnchor[],
  createdBy: string | null | undefined,
): Promise<void> {
  if (!anchors.length) return;
  await db.insert(routeRepairAnchorsTable).values(anchors.map((anchor) => ({
    transitLineId,
    sequence: anchor.sequence,
    direction: anchor.direction,
    name: anchor.name,
    nameAr: anchor.nameAr ?? null,
    lat: anchor.point[1],
    lng: anchor.point[0],
    source: anchor.source,
    required: anchor.required,
    confidenceScore: anchor.confidenceScore,
    anchorType: anchor.anchorType,
    createdBy: createdBy ?? null,
  })));
}

export async function saveRepairCandidate(
  line: TransitLine,
  result: RepairCandidateResult,
  options: { apply?: boolean; createdBy?: string | null; persistAnchors?: boolean } = {},
): Promise<StoredRepairResult> {
  if (!result.geometry || !result.metrics) return result;
  await ensureLegacyGeometryVersion(line, options.createdBy);

  if (options.persistAnchors) {
    await persistRepairAnchors(line.id, result.anchors, options.createdBy);
  }

  const [version] = await db.insert(routeGeometryVersionsTable).values({
    transitLineId: line.id,
    version: await nextGeometryVersion(line.id),
    geometry: result.geometry,
    source: result.source,
    status: result.confidenceLevel === "low" ? "needs_review" : "candidate",
    qualityScore: result.qualityScore,
    confidenceScore: result.confidenceScore,
    metrics: result.metrics as unknown as Record<string, unknown>,
    evidence: result.evidence,
    createdBy: options.createdBy ?? null,
  }).returning();

  if (result.confidenceLevel === "low") {
    await db.update(transitLinesTable).set({
      routeStatus: "needs_review",
      needsReviewReason: result.reason ?? result.warnings[0] ?? "low_confidence_route_candidate",
      routeQuality: {
        qualityScore: result.qualityScore,
        confidenceScore: result.confidenceScore,
        confidenceLevel: result.confidenceLevel,
        source: result.source,
        generatedAt: new Date().toISOString(),
        metrics: result.metrics as unknown as Record<string, unknown>,
        warnings: result.warnings,
      },
      updatedAt: new Date(),
    }).where(eq(transitLinesTable.id, line.id));
  }

  let accepted = false;
  if (options.apply && result.publishable) {
    await acceptGeometryVersion(line.id, version.id);
    accepted = true;
  }

  return {
    ...result,
    versionId: version.id,
    version: version.version,
    accepted,
  };
}

export async function acceptGeometryVersion(transitLineId: string, versionId: string): Promise<RouteGeometryVersion> {
  const [version] = await db
    .select()
    .from(routeGeometryVersionsTable)
    .where(and(
      eq(routeGeometryVersionsTable.transitLineId, transitLineId),
      eq(routeGeometryVersionsTable.id, versionId),
    ))
    .limit(1);

  if (!version) throw new Error("geometry candidate not found");

  const metrics = version.metrics as RepairMetrics | Record<string, unknown>;
  const failedSegmentCount = Number((metrics as { failedSegmentCount?: number }).failedSegmentCount ?? 0);
  const confidenceLevel = String((metrics as { confidenceLevel?: string }).confidenceLevel ?? "");
  const warnings = Array.isArray((metrics as { warnings?: unknown }).warnings)
    ? (metrics as { warnings: string[] }).warnings
    : [];

  if (failedSegmentCount > 0) throw new Error("cannot accept geometry with unresolved failed segments");
  if (confidenceLevel === "low") throw new Error("low-confidence geometry needs more anchors or manual repair before acceptance");
  if (warnings.includes("hard_quality_reject")) throw new Error("candidate failed hard quality checks");
  if (!version.geometry?.coordinates || version.geometry.coordinates.length < 2) throw new Error("candidate geometry is empty");

  await db.update(routeGeometryVersionsTable)
    .set({ status: "superseded" })
    .where(and(
      eq(routeGeometryVersionsTable.transitLineId, transitLineId),
      eq(routeGeometryVersionsTable.status, "accepted"),
    ));

  const [accepted] = await db.update(routeGeometryVersionsTable)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(eq(routeGeometryVersionsTable.id, versionId))
    .returning();

  await db.update(transitLinesTable).set({
    routePath: accepted.geometry,
    routeStatus: "active",
    activeGeometryVersionId: accepted.id,
    confidenceScore: accepted.confidenceScore,
    routeQuality: {
      qualityScore: accepted.qualityScore,
      confidenceScore: accepted.confidenceScore,
      confidenceLevel: confidenceLevel === "medium" ? "medium" : "high",
      source: accepted.source,
      generatedAt: new Date().toISOString(),
      metrics: accepted.metrics,
      warnings,
    },
    needsReviewReason: null,
    verifiedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(transitLinesTable.id, transitLineId));

  invalidateGraph();
  return accepted;
}

export async function rejectGeometryVersion(transitLineId: string, versionId: string): Promise<RouteGeometryVersion> {
  const [version] = await db.update(routeGeometryVersionsTable)
    .set({ status: "rejected", rejectedAt: new Date() })
    .where(and(
      eq(routeGeometryVersionsTable.transitLineId, transitLineId),
      eq(routeGeometryVersionsTable.id, versionId),
    ))
    .returning();
  if (!version) throw new Error("geometry candidate not found");
  return version;
}

export async function listGeometryVersions(transitLineId: string): Promise<RouteGeometryVersion[]> {
  return db
    .select()
    .from(routeGeometryVersionsTable)
    .where(eq(routeGeometryVersionsTable.transitLineId, transitLineId))
    .orderBy(desc(routeGeometryVersionsTable.version));
}

export function auditGeometry(line: TransitLine, transportType: TransportType | null | undefined): {
  guard: RepairGuard;
  hasGeometry: boolean;
  pointCount: number;
  maxStepKm: number | null;
  lengthKm: number | null;
  warnings: string[];
} {
  const guard = canRepairRoadRoute(line, transportType);
  const coords = oldPathCoords(line);
  if (!coords) {
    return {
      guard,
      hasGeometry: false,
      pointCount: 0,
      maxStepKm: null,
      lengthKm: null,
      warnings: ["missing_geometry"],
    };
  }
  const cleaned = cleanRoutePath(coords);
  const warnings = [...cleaned.warnings];
  const step = maxStepKm(cleaned.points);
  if (step > 0.75) warnings.push("high_max_step");
  const length = totalLengthKm(cleaned.points);
  return {
    guard,
    hasGeometry: true,
    pointCount: cleaned.points.length,
    maxStepKm: Number(step.toFixed(3)),
    lengthKm: Number(length.toFixed(3)),
    warnings: unique(warnings),
  };
}
