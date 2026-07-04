import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@workspace/db";

type LngLat = [number, number];
type Anchor = { lat: number; lng: number; name: string; source: string; required: boolean };
type OSMNameIndex = Record<string, LngLat[]>;
type LineRow = {
  id: string;
  line_number: string | null;
  name_en: string;
  from_area: string;
  to_area: string;
  governorate: string;
  via_stops: string[];
  stops: { name?: string; lat: number; lng: number }[] | null;
  route_path: { type: string; coordinates: LngLat[] } | null;
  transport_name: string;
  data_source: string;
};

const DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json";
const OUTPUT = path.resolve(process.cwd(), "scripts/generated/google-route-regeneration-audit.json");
const STOP_CHAIN_OUTPUT = path.resolve(process.cwd(), "scripts/generated/cairo-stop-chain-audit.json");
const FIXED_GUIDEWAY = /metro|monorail|tram|train|rail|lrt|subway/i;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function arg(name: string, fallback?: string): string | undefined {
  const exact = process.argv.indexOf(`--${name}`);
  if (exact >= 0) return process.argv[exact + 1];
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3) ?? fallback;
}

function integerArg(name: string, fallback: number): number {
  const parsed = Number(arg(name));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function haversineKm(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function pathLengthKm(points: LngLat[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index++) total += haversineKm(points[index - 1], points[index]);
  return total;
}

function repeatedTraversalRatio(points: LngLat[]): number {
  const traversed = new Set<string>();
  let repeatedKm = 0;
  let totalKm = 0;
  const cell = ([lng, lat]: LngLat) => `${Math.round(lng * 2000)}:${Math.round(lat * 2000)}`;
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1];
    const end = points[index];
    const km = haversineKm(start, end);
    const pieces = Math.max(1, Math.ceil(km / 0.05));
    let previousCell = cell(start);
    for (let piece = 1; piece <= pieces; piece++) {
      const ratio = piece / pieces;
      const current: LngLat = [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
      const currentCell = cell(current);
      const pieceKm = km / pieces;
      totalKm += pieceKm;
      if (currentCell !== previousCell) {
        const edge = previousCell < currentCell ? `${previousCell}|${currentCell}` : `${currentCell}|${previousCell}`;
        if (traversed.has(edge)) repeatedKm += pieceKm;
        else traversed.add(edge);
      }
      previousCell = currentCell;
    }
  }
  return totalKm > 0 ? repeatedKm / totalKm : 0;
}

/** Decodes the Polyline5 string returned by Google Directions. */
function decodePolyline5(encoded: string): LngLat[] {
  const output: LngLat[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    const decodeValue = () => {
      let result = 0;
      let shift = 0;
      let byte = 0;
      do {
        if (index >= encoded.length) throw new Error("Invalid truncated Google polyline");
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      return (result & 1) ? ~(result >> 1) : result >> 1;
    };
    latitude += decodeValue();
    longitude += decodeValue();
    output.push([longitude / 1e5, latitude / 1e5]);
  }
  return output;
}

function validAnchor(anchor: Anchor): boolean {
  return Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng)
    && anchor.lat >= 21.5 && anchor.lat <= 31.8 && anchor.lng >= 24.5 && anchor.lng <= 36.9;
}

function normalizePlaceName(value: string): string {
  return value
    .split(",")[0]
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

async function loadOsmNameIndex(input: string | undefined): Promise<OSMNameIndex | null> {
  if (!input) return null;
  const parsed = JSON.parse(await readFile(path.resolve(input), "utf8")) as { names?: OSMNameIndex };
  return parsed.names ?? null;
}

function contextualizeNamedAnchors(anchors: Anchor[], governorate: string, index: OSMNameIndex | null): Anchor[] {
  if (!index || anchors.length < 2) return anchors;
  const bounds = governorateBounds(governorate);
  const choices = anchors.map((anchor) => {
    if (/عز(?:بة|ية)\s+خير\s+الله/.test(anchor.name)) {
      return [{ ...anchor, lat: 29.9871, lng: 31.2500, source: "manual_context_alias" }];
    }
    if (anchor.source !== "google_resolved_named_corridor") return [anchor];
    const position = anchors.indexOf(anchor);
    const outside = Boolean(bounds) && (anchor.lng < bounds!.minLng || anchor.lng > bounds!.maxLng || anchor.lat < bounds!.minLat || anchor.lat > bounds!.maxLat);
    const neighbor = position === 0 ? anchors[1] : position === anchors.length - 1 ? anchors[position - 1] : undefined;
    // Preserve a plausibly connected outside endpoint. This is evidence of a
    // genuine inter-governorate service, not an isolated same-name match.
    if (outside && neighbor && (position === 0 || position === anchors.length - 1)
      && haversineKm([anchor.lng, anchor.lat], [neighbor.lng, neighbor.lat]) <= 45) return [anchor];
    const candidates = index[normalizePlaceName(anchor.name)] ?? [];
    const inArea = candidates
      .filter(([lng, lat]) => !bounds || (lng >= bounds.minLng && lng <= bounds.maxLng && lat >= bounds.minLat && lat <= bounds.maxLat))
      .map(([lng, lat]) => ({ lat, lng, name: anchor.name, source: "osm_context_candidate", required: true }));
    inArea.sort((a, b) => haversineKm([a.lng, a.lat], [anchor.lng, anchor.lat]) - haversineKm([b.lng, b.lat], [anchor.lng, anchor.lat]));
    const diverse: Anchor[] = [anchor];
    for (const candidate of inArea) {
      if (diverse.length >= 60) break;
      if (diverse.every((existing) => haversineKm([existing.lng, existing.lat], [candidate.lng, candidate.lat]) > 0.35)) diverse.push(candidate);
    }
    return diverse;
  });

  const costs: number[][] = choices.map((row) => row.map(() => Infinity));
  const previous: number[][] = choices.map((row) => row.map(() => -1));
  for (let candidate = 0; candidate < choices[0].length; candidate++) costs[0][candidate] = 0;
  for (let indexPosition = 1; indexPosition < choices.length; indexPosition++) {
    for (let candidate = 0; candidate < choices[indexPosition].length; candidate++) {
      const current = choices[indexPosition][candidate];
      const googleBias = current.source === "osm_context_candidate"
        ? haversineKm([current.lng, current.lat], [anchors[indexPosition].lng, anchors[indexPosition].lat]) * 0.12
        : 0;
      for (let prior = 0; prior < choices[indexPosition - 1].length; prior++) {
        const before = choices[indexPosition - 1][prior];
        const gap = haversineKm([before.lng, before.lat], [current.lng, current.lat]);
        const longGapPenalty = gap > 35 ? (gap - 35) * 4 : 0;
        const score = costs[indexPosition - 1][prior] + gap + longGapPenalty + googleBias;
        if (score < costs[indexPosition][candidate]) {
          costs[indexPosition][candidate] = score;
          previous[indexPosition][candidate] = prior;
        }
      }
    }
  }

  let selected = costs[costs.length - 1].reduce((best, value, candidate) => value < costs[costs.length - 1][best] ? candidate : best, 0);
  const result = new Array<Anchor>(anchors.length);
  for (let position = anchors.length - 1; position >= 0; position--) {
    const chosen = choices[position][selected];
    result[position] = chosen.source === "osm_context_candidate"
      ? { ...chosen, source: "osm_context_disambiguated" }
      : chosen;
    selected = position > 0 ? previous[position][selected] : 0;
  }
  return result;
}

function sanitizeAnchors(input: Anchor[], limitForSingleRequest = true): { anchors: Anchor[]; warnings: string[] } {
  const warnings: string[] = [];
  const deduped: Anchor[] = [];
  for (const anchor of input.filter(validAnchor)) {
    const previous = deduped[deduped.length - 1];
    if (!previous || haversineKm([previous.lng, previous.lat], [anchor.lng, anchor.lat]) >= 0.03) deduped.push(anchor);
  }

  const cleaned = [...deduped];
  for (let index = cleaned.length - 2; index >= 1; index--) {
    const previous: LngLat = [cleaned[index - 1].lng, cleaned[index - 1].lat];
    const current: LngLat = [cleaned[index].lng, cleaned[index].lat];
    const next: LngLat = [cleaned[index + 1].lng, cleaned[index + 1].lat];
    const detour = haversineKm(previous, current) + haversineKm(current, next);
    const bypass = Math.max(0.05, haversineKm(previous, next));
    if (!cleaned[index].required && detour > 4 && detour / bypass > 4) {
      warnings.push(`Removed implausible optional anchor: ${cleaned[index].name || index}`);
      cleaned.splice(index, 1);
    }
  }

  // Legacy Directions supports at most 25 waypoints. Keep endpoints and a
  // uniformly distributed set of corridor anchors without changing order.
  if (limitForSingleRequest && cleaned.length > 27) {
    const interior = cleaned.slice(1, -1);
    const sampled: Anchor[] = [];
    for (let index = 0; index < 25; index++) {
      sampled.push(interior[Math.round(index * (interior.length - 1) / 24)]);
    }
    warnings.push(`Reduced ${cleaned.length} ordered anchors to 27 for the Google request limit`);
    return { anchors: [cleaned[0], ...sampled, cleaned[cleaned.length - 1]], warnings };
  }
  return { anchors: cleaned, warnings };
}

function analyzeAnchorChain(anchors: Anchor[]) {
  const segments = anchors.slice(1).map((anchor, index) => ({
    fromIndex: index,
    toIndex: index + 1,
    from: anchors[index].name,
    to: anchor.name,
    distanceKm: haversineKm([anchors[index].lng, anchors[index].lat], [anchor.lng, anchor.lat]),
  }));
  const directKm = anchors.length >= 2
    ? haversineKm([anchors[0].lng, anchors[0].lat], [anchors.at(-1)!.lng, anchors.at(-1)!.lat])
    : 0;
  const chainKm = segments.reduce((sum, segment) => sum + segment.distanceKm, 0);
  const suspicious: Array<Record<string, unknown>> = [];
  for (let index = 1; index < anchors.length - 1; index++) {
    const previous: LngLat = [anchors[index - 1].lng, anchors[index - 1].lat];
    const current: LngLat = [anchors[index].lng, anchors[index].lat];
    const next: LngLat = [anchors[index + 1].lng, anchors[index + 1].lat];
    const incomingKm = haversineKm(previous, current);
    const outgoingKm = haversineKm(current, next);
    const bypassKm = Math.max(0.05, haversineKm(previous, next));
    const localExcessKm = incomingKm + outgoingKm - bypassKm;
    const localDetourRatio = (incomingKm + outgoingKm) / bypassKm;
    if ((localExcessKm > 5 && localDetourRatio > 2.2) || incomingKm > 30 || outgoingKm > 30) {
      suspicious.push({ index, name: anchors[index].name, incomingKm, outgoingKm, bypassKm, localExcessKm, localDetourRatio });
    }
  }
  const duplicates = segments.filter((segment) => segment.distanceKm < 0.03);
  const largeGaps = segments.filter((segment) => segment.distanceKm > 20);
  return {
    anchorCount: anchors.length,
    directKm,
    chainKm,
    chainToDirectRatio: directKm > 0.5 ? chainKm / directKm : null,
    maximumGapKm: segments.reduce((maximum, segment) => Math.max(maximum, segment.distanceKm), 0),
    duplicateCount: duplicates.length,
    largeGapCount: largeGaps.length,
    suspiciousCount: suspicious.length,
    suspicious,
    largeGaps,
    segments,
    anchors: anchors.map((anchor, index) => ({ index, name: anchor.name, lat: anchor.lat, lng: anchor.lng, source: anchor.source, required: anchor.required })),
  };
}

async function anchorsForLine(line: LineRow): Promise<{ anchors: Anchor[]; warnings: string[] }> {
  if (Array.isArray(line.stops) && line.stops.length >= 2) {
    return sanitizeAnchors(line.stops.map((stop, index) => ({
      lat: Number(stop.lat), lng: Number(stop.lng), name: stop.name || `stop ${index + 1}`,
      source: "structured_stop", required: true,
    })), false);
  }

  const result = await pool.query<{
    lat: number; lng: number; name: string; source: string; required: boolean;
  }>(`
    SELECT lat, lng, name, source, required
    FROM route_repair_anchors
    WHERE transit_line_id = $1 AND direction = 'forward'
      AND source NOT IN ('existing_path_sample', 'route_path_derived')
    ORDER BY sequence ASC
  `, [line.id]);
  if (result.rows.length >= 2) {
    return sanitizeAnchors(result.rows.map((row) => ({ ...row, lat: Number(row.lat), lng: Number(row.lng) })));
  }

  const oldPath = line.route_path?.coordinates?.filter((point) =>
    Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]),
  ) ?? [];
  if (oldPath.length >= 2) {
    return sanitizeAnchors([
      { lng: oldPath[0][0], lat: oldPath[0][1], name: line.from_area, source: "endpoint_only", required: true },
      { lng: oldPath[oldPath.length - 1][0], lat: oldPath[oldPath.length - 1][1], name: line.to_area, source: "endpoint_only", required: true },
    ]);
  }
  return { anchors: [], warnings: ["No coordinate anchors"] };
}

type GoogleLocation = Anchor | string;

function locationValue(location: GoogleLocation): string {
  return typeof location === "string" ? location : `${location.lat},${location.lng}`;
}

function limitGoogleLocations(locations: GoogleLocation[]): GoogleLocation[] {
  if (locations.length <= 27) return locations;
  const interior = locations.slice(1, -1);
  const sampled: GoogleLocation[] = [];
  for (let index = 0; index < 25; index++) sampled.push(interior[Math.round(index * (interior.length - 1) / 24)]);
  return [locations[0], ...sampled, locations[locations.length - 1]];
}

function governorateBounds(governorate: string) {
  const normalized = governorate.toLowerCase();
  if (normalized.includes("alex")) return { minLng: 29.25, maxLng: 30.45, minLat: 30.65, maxLat: 31.45 };
  if (normalized.includes("cairo") || normalized.includes("giza")) return { minLng: 30.55, maxLng: 32.05, minLat: 29.55, maxLat: 30.65 };
  return null;
}

async function resolveNamedLocations(apiKey: string, rawLocations: GoogleLocation[], governorate: string): Promise<Anchor[]> {
  const locations = limitGoogleLocations(rawLocations);
  const params = new URLSearchParams({
    origin: locationValue(locations[0]),
    destination: locationValue(locations[locations.length - 1]),
    mode: "driving",
    alternatives: "false",
    units: "metric",
    region: "eg",
    key: apiKey,
  });
  if (locations.length > 2) params.set("waypoints", locations.slice(1, -1).map(locationValue).join("|"));

  let lastError = "Google location resolution failed";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(`${DIRECTIONS_URL}?${params}`, { signal: AbortSignal.timeout(20_000) });
      const body = await response.json() as {
        status?: string; error_message?: string;
        routes?: { legs?: { start_location?: { lat: number; lng: number }; end_location?: { lat: number; lng: number } }[] }[];
      };
      if (response.ok && body.status === "OK") {
        const legs = body.routes?.[0]?.legs ?? [];
        if (legs.length !== locations.length - 1 || !legs[0]?.start_location) throw new Error("Google did not resolve every ordered location");
        const resolved = [legs[0].start_location, ...legs.map((leg) => leg.end_location)].map((coordinate, index) => ({
          lat: Number(coordinate?.lat),
          lng: Number(coordinate?.lng),
          name: typeof locations[index] === "string" ? locations[index] as string : (locations[index] as Anchor).name,
          source: typeof locations[index] === "string" ? "google_resolved_named_corridor" : (locations[index] as Anchor).source,
          required: true,
        }));
        if (resolved.some((anchor) => !validAnchor(anchor))) throw new Error("Google resolved a location outside Egypt");
        // Do not reject distant same-name matches here. The caller first runs
        // contextual OSM disambiguation, then applies the coherent-outbound
        // test. Rejecting at this point prevents the local candidate from ever
        // being considered.
        return resolved;
      }
      lastError = `${body.status || response.status}: ${body.error_message || response.statusText}`;
      if (response.status !== 429 && response.status < 500 && body.status !== "UNKNOWN_ERROR") break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500 * 2 ** attempt);
  }
  throw new Error(lastError);
}

function coherentOutboundChain(anchors: Anchor[], governorate: string) {
  const bounds = governorateBounds(governorate);
  if (!bounds || anchors.length < 2) return { allowed: false, outsideCount: 0, outsideIndexes: [] as number[] };
  const outsideIndexes = anchors
    .map((anchor, index) => ({ anchor, index }))
    .filter(({ anchor }) => anchor.lng < bounds.minLng || anchor.lng > bounds.maxLng || anchor.lat < bounds.minLat || anchor.lat > bounds.maxLat)
    .map(({ index }) => index);
  if (!outsideIndexes.length) return { allowed: false, outsideCount: 0, outsideIndexes };
  const outside = new Set(outsideIndexes);
  const hasInside = outsideIndexes.length < anchors.length;
  const onlyAtEnds = outsideIndexes.every((index) => {
    const prefix = anchors.slice(0, index + 1).every((_, candidate) => outside.has(candidate));
    const suffix = anchors.slice(index).every((_, offset) => outside.has(index + offset));
    return prefix || suffix;
  });
  const chain = analyzeAnchorChain(anchors);
  const allowed = hasInside && onlyAtEnds && chain.suspiciousCount === 0
    && chain.maximumGapKm <= 45
    && (chain.chainToDirectRatio === null || chain.chainToDirectRatio <= 2.5);
  return { allowed, outsideCount: outsideIndexes.length, outsideIndexes, chain };
}

async function googleRoute(apiKey: string, rawLocations: GoogleLocation[]): Promise<{ points: LngLat[]; status: string }> {
  const locations = limitGoogleLocations(rawLocations);
  const params = new URLSearchParams({
    origin: locationValue(locations[0]),
    destination: locationValue(locations[locations.length - 1]),
    mode: "driving",
    alternatives: "false",
    units: "metric",
    region: "eg",
    key: apiKey,
  });
  if (locations.length > 2) {
    params.set("waypoints", locations.slice(1, -1).map((location) => `via:${locationValue(location)}`).join("|"));
  }

  let lastError = "Google request failed";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(`${DIRECTIONS_URL}?${params}`, { signal: AbortSignal.timeout(20_000) });
      const body = await response.json() as {
        status?: string; error_message?: string;
        routes?: { overview_polyline?: { points?: string } }[];
      };
      if (response.ok && body.status === "OK") {
        const encoded = body.routes?.[0]?.overview_polyline?.points;
        if (!encoded) throw new Error("Google returned OK without overview_polyline.points");
        const points = decodePolyline5(encoded);
        const first = locations[0];
        const last = locations[locations.length - 1];
        if (typeof first !== "string") points[0] = [first.lng, first.lat];
        if (typeof last !== "string") points[points.length - 1] = [last.lng, last.lat];
        return { points, status: body.status };
      }
      lastError = `${body.status || response.status}: ${body.error_message || response.statusText}`;
      if (response.status !== 429 && response.status < 500 && body.status !== "UNKNOWN_ERROR") break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500 * 2 ** attempt);
  }
  throw new Error(lastError);
}

async function googleRouteBySections(apiKey: string, locations: GoogleLocation[]): Promise<LngLat[]> {
  const stitched: LngLat[] = [];
  for (let index = 1; index < locations.length; index++) {
    const section = await googleRoute(apiKey, [locations[index - 1], locations[index]]);
    for (const point of section.points) {
      const previous = stitched[stitched.length - 1];
      if (!previous || haversineKm(previous, point) > 0.002) stitched.push(point);
    }
    if (index < locations.length - 1) await sleep(100);
  }
  return stitched;
}

function monotonicCorridorSubset(locations: GoogleLocation[], baseline: LngLat[]) {
  if (locations.length < 5 || locations.some((location) => typeof location === "string")) return null;
  const anchors = locations as Anchor[];
  const projected = anchors.map((anchor, originalIndex) => {
    let pathIndex = 0;
    let distanceKm = Number.POSITIVE_INFINITY;
    for (let index = 0; index < baseline.length; index++) {
      const distance = haversineKm(baseline[index], [anchor.lng, anchor.lat]);
      if (distance < distanceKm) {
        distanceKm = distance;
        pathIndex = index;
      }
    }
    return { anchor, originalIndex, pathIndex, distanceKm };
  });
  const eligible = projected.filter((item) => item.originalIndex === 0
    || item.originalIndex === projected.length - 1
    || item.distanceKm <= 3);
  if (eligible.length < 4) return null;

  const scores = eligible.map(() => Number.NEGATIVE_INFINITY);
  const previous = eligible.map(() => -1);
  scores[0] = 1;
  for (let index = 1; index < eligible.length; index++) {
    const current = eligible[index];
    const weight = current.originalIndex === projected.length - 1 ? 1 : Math.max(0.05, 1 - current.distanceKm / 3);
    for (let prior = 0; prior < index; prior++) {
      if (!Number.isFinite(scores[prior]) || eligible[prior].pathIndex > current.pathIndex) continue;
      const score = scores[prior] + weight;
      if (score > scores[index]) {
        scores[index] = score;
        previous[index] = prior;
      }
    }
  }
  const endIndex = eligible.findIndex((item) => item.originalIndex === projected.length - 1);
  if (endIndex < 0 || !Number.isFinite(scores[endIndex])) return null;
  const selected: typeof eligible = [];
  let cursor = endIndex;
  while (cursor >= 0) {
    selected.push(eligible[cursor]);
    cursor = previous[cursor];
  }
  selected.reverse();
  if (selected[0]?.originalIndex !== 0 || selected.at(-1)?.originalIndex !== projected.length - 1) return null;
  const retainedInterior = Math.max(0, selected.length - 2);
  const totalInterior = Math.max(1, projected.length - 2);
  const retentionRatio = retainedInterior / totalInterior;
  if (selected.length < 4 || retentionRatio < 0.45) return null;
  const selectedIndexes = new Set(selected.map((item) => item.originalIndex));
  return {
    locations: selected.map((item) => item.anchor),
    retentionRatio,
    removedConstraints: projected
      .filter((item) => !selectedIndexes.has(item.originalIndex))
      .map((item) => item.anchor.name),
  };
}

function thinOrderedAnchors(locations: GoogleLocation[]): Anchor[] | null {
  if (locations.length < 6 || locations.some((location) => typeof location === "string")) return null;
  const anchors = locations as Anchor[];
  const selected: Anchor[] = [anchors[0]];
  let travelledSinceSelection = 0;
  for (let index = 1; index < anchors.length - 1; index++) {
    travelledSinceSelection += haversineKm(
      [anchors[index - 1].lng, anchors[index - 1].lat],
      [anchors[index].lng, anchors[index].lat],
    );
    if (travelledSinceSelection >= 3) {
      selected.push(anchors[index]);
      travelledSinceSelection = 0;
    }
  }
  selected.push(anchors.at(-1)!);
  if (selected.length > 12) {
    const sampled: Anchor[] = [];
    for (let index = 0; index < 12; index++) sampled.push(selected[Math.round(index * (selected.length - 1) / 11)]);
    return sampled;
  }
  return selected.length < anchors.length ? selected : null;
}

function simplifyCorridorShape(locations: GoogleLocation[], toleranceKm = 0.8): Anchor[] | null {
  if (locations.length < 5 || locations.some((location) => typeof location === "string")) return null;
  const anchors = locations as Anchor[];
  const distanceToSegment = (point: Anchor, start: Anchor, end: Anchor) => {
    const latitude = (start.lat + end.lat + point.lat) / 3 * Math.PI / 180;
    const scaleX = 111.32 * Math.cos(latitude);
    const px = (point.lng - start.lng) * scaleX;
    const py = (point.lat - start.lat) * 111.32;
    const ex = (end.lng - start.lng) * scaleX;
    const ey = (end.lat - start.lat) * 111.32;
    const denominator = ex * ex + ey * ey;
    const fraction = denominator > 0 ? Math.max(0, Math.min(1, (px * ex + py * ey) / denominator)) : 0;
    return Math.hypot(px - fraction * ex, py - fraction * ey);
  };
  const keep = new Set<number>([0, anchors.length - 1]);
  const simplify = (startIndex: number, endIndex: number) => {
    let maximumKm = 0;
    let selectedIndex = -1;
    for (let index = startIndex + 1; index < endIndex; index++) {
      const km = distanceToSegment(anchors[index], anchors[startIndex], anchors[endIndex]);
      if (km > maximumKm) {
        maximumKm = km;
        selectedIndex = index;
      }
    }
    if (selectedIndex >= 0 && maximumKm > toleranceKm) {
      keep.add(selectedIndex);
      simplify(startIndex, selectedIndex);
      simplify(selectedIndex, endIndex);
    }
  };
  simplify(0, anchors.length - 1);
  let selected = [...keep].sort((a, b) => a - b).map((index) => anchors[index]);
  if (selected.length > 12) {
    selected = Array.from({ length: 12 }, (_, index) => selected[Math.round(index * (selected.length - 1) / 11)]);
  }
  return selected.length >= 3 && selected.length < anchors.length ? selected : null;
}

function cleanLocalNamedOutliers(locations: GoogleLocation[]) {
  if (locations.length < 4 || locations.some((location) => typeof location === "string")) return null;
  const original = locations as Anchor[];
  if (original.some((anchor) => anchor.source === "structured_stop")) return null;
  const cleaned = [...original];
  const removed: Anchor[] = [];
  while (cleaned.length > 3) {
    const chain = analyzeAnchorChain(cleaned);
    const duplicate = chain.segments.find((segment) => segment.distanceKm < 0.03 && segment.toIndex < cleaned.length - 1);
    if (duplicate) {
      removed.push(cleaned[duplicate.toIndex]);
      cleaned.splice(duplicate.toIndex, 1);
      continue;
    }
    const outlier = [...chain.suspicious]
      .sort((a, b) => Number(b.localExcessKm) - Number(a.localExcessKm))[0] as { index?: number } | undefined;
    if (!outlier || !Number.isInteger(outlier.index) || Number(outlier.index) <= 0 || Number(outlier.index) >= cleaned.length - 1) break;
    removed.push(cleaned[Number(outlier.index)]);
    cleaned.splice(Number(outlier.index), 1);
  }
  const retentionRatio = Math.max(0, cleaned.length - 2) / Math.max(1, original.length - 2);
  if (!removed.length || cleaned.length < 4 || retentionRatio < 0.55 || analyzeAnchorChain(cleaned).suspiciousCount > 0) return null;
  return { locations: cleaned, removedConstraints: removed.map((anchor) => anchor.name), retentionRatio };
}

function validateGeometry(points: LngLat[], anchors: Anchor[], allowOrderedCorridorDetour = false, governorate = "", allowOutsideServiceArea = false) {
  const directKm = haversineKm(points[0], points[points.length - 1]);
  const lengthKm = pathLengthKm(points);
  const maxStepKm = points.slice(1).reduce((max, point, index) => Math.max(max, haversineKm(points[index], point)), 0);
  const anchorMisses = anchors.filter((anchor) => {
    const target: LngLat = [anchor.lng, anchor.lat];
    let nearest = Infinity;
    for (const point of points) nearest = Math.min(nearest, haversineKm(point, target));
    return nearest > 0.65; // overview polylines are simplified; keep a conservative tolerance
  }).length;
  const warnings: string[] = [];
  if (points.length < 2) warnings.push("Google geometry has fewer than two points");
  if (maxStepKm > 3) warnings.push(`Overview polyline contains a ${maxStepKm.toFixed(2)} km jump`);
  if (!allowOrderedCorridorDetour && directKm > 1 && lengthKm / directKm > 6) warnings.push(`Extreme detour ratio ${(lengthKm / directKm).toFixed(2)}`);
  if (anchorMisses > 0) warnings.push(`${anchorMisses} required anchors are over 650 m from overview geometry`);
  const anchorChainKm = anchors.length >= 2
    ? anchors.slice(1).reduce((sum, anchor, index) => sum + haversineKm(
      [anchors[index].lng, anchors[index].lat], [anchor.lng, anchor.lat],
    ), 0)
    : directKm;
  const corridorEfficiency = lengthKm > 0 ? anchorChainKm / lengthKm : 0;
  const corridorExcessFactor = anchorChainKm > 0 ? lengthKm / anchorChainKm : Infinity;
  const maximumExcessFactor = anchors.length >= 3 ? 2 : 2.5;
  if (corridorExcessFactor > maximumExcessFactor) {
    warnings.push(`Route is ${corridorExcessFactor.toFixed(2)}x its ${anchors.length >= 3 ? "ordered anchor chain" : "endpoint displacement"}`);
  }
  const repeatedRatio = repeatedTraversalRatio(points);
  if (repeatedRatio > 0.1) warnings.push(`Repeated traversal ratio ${(repeatedRatio * 100).toFixed(1)}%`);

  let travelled = 0;
  let loopReentries = 0;
  const visited = new Map<string, { index: number; travelled: number }>();
  const reentryIndexes: number[] = [];
  for (let index = 0; index < points.length; index++) {
    if (index > 0) travelled += haversineKm(points[index - 1], points[index]);
    const [lng, lat] = points[index];
    const cell = `${Math.round(lng * 1000)}:${Math.round(lat * 1000)}`;
    const previous = visited.get(cell);
    if (previous && index - previous.index > 8 && travelled - previous.travelled > 2) reentryIndexes.push(index);
    visited.set(cell, { index, travelled });
  }
  let runLength = 0;
  let previousIndex = -10;
  for (const index of reentryIndexes) {
    runLength = index - previousIndex <= 2 ? runLength + 1 : 1;
    if (runLength === 4) loopReentries++;
    previousIndex = index;
  }
  if (loopReentries > 0) warnings.push(`${loopReentries} long loop re-entry/re-entries`);

  const serviceBounds = governorateBounds(governorate);
  const outsideServiceArea = serviceBounds
    ? points.filter(([lng, lat]) => lng < serviceBounds.minLng || lng > serviceBounds.maxLng || lat < serviceBounds.minLat || lat > serviceBounds.maxLat).length
    : 0;
  if (!allowOutsideServiceArea && outsideServiceArea > Math.max(3, points.length * 0.02)) warnings.push(`${outsideServiceArea} points leave the ${governorate} service area`);
  return { accepted: warnings.length === 0, warnings, lengthKm, directKm, anchorChainKm, corridorEfficiency, corridorExcessFactor, repeatedRatio, maxStepKm, anchorMisses, loopReentries, outsideServiceArea };
}

async function solveWithConstraintRetries(
  apiKey: string,
  primary: GoogleLocation[],
  coordinateAnchors: Anchor[],
  governorate: string,
  sectionalFallback: boolean,
  allowOutsideServiceArea = false,
) {
  const candidates: { strategy: string; locations: GoogleLocation[]; removedConstraints: string[]; retentionRatio?: number; precomputedPoints?: LngLat[]; validationAnchors?: Anchor[]; evidenceLocations?: GoogleLocation[] }[] = [
    { strategy: "all_ordered_constraints", locations: primary, removedConstraints: [] },
  ];
  if (sectionalFallback && primary.length > 2) {
    for (let index = 1; index < primary.length - 1; index++) {
      const removed = primary[index];
      if (typeof removed !== "string" && removed.source === "structured_stop") continue;
      candidates.push({
        strategy: "leave_one_constraint_out",
        locations: primary.filter((_, candidateIndex) => candidateIndex !== index),
        removedConstraints: [typeof removed === "string" ? removed : removed.name],
      });
    }
  }
  const locallyCleaned = cleanLocalNamedOutliers(primary);
  if (locallyCleaned) candidates.push({ strategy: "locally_cleaned_stop_chain", ...locallyCleaned });
  if (coordinateAnchors.length >= 2 && primary.length !== coordinateAnchors.length) {
    candidates.push({ strategy: "coordinate_constraints_only", locations: coordinateAnchors, removedConstraints: ["all named corridor constraints"] });
  }
  const simplified = simplifyCorridorShape(primary);
  if (simplified) {
    candidates.push({
      strategy: "simplified_corridor_shape",
      locations: simplified,
      removedConstraints: [],
      validationAnchors: primary as Anchor[],
      evidenceLocations: primary,
    });
  }
  const thinned = thinOrderedAnchors(primary);
  if (thinned) {
    candidates.push({
      strategy: "thinned_ordered_corridor",
      locations: thinned,
      removedConstraints: [],
      validationAnchors: primary as Anchor[],
      evidenceLocations: primary,
    });
  }
  let baseline: { points: LngLat[]; status: string } | undefined;
  if (primary.length >= 5) {
    try {
      baseline = await googleRoute(apiKey, [primary[0], primary[primary.length - 1]]);
      const subset = monotonicCorridorSubset(primary, baseline.points);
      if (subset) candidates.push({ strategy: "monotonic_corridor_subset", ...subset });
    } catch {
      // The regular candidate loop will report the endpoint failure below.
    }
  }
  candidates.push({ strategy: "endpoints_only", locations: [primary[0], primary[primary.length - 1]], removedConstraints: ["all intermediate constraints"], precomputedPoints: baseline?.points });

  const seen = new Set<string>();
  const attempts: Record<string, unknown>[] = [];
  const accepted: {
    strategy: string; locations: GoogleLocation[]; removedConstraints: string[];
    points: LngLat[]; metrics: ReturnType<typeof validateGeometry>; retentionRatio?: number;
  }[] = [];
  if (primary.length > 2) {
    try {
      const points = await googleRouteBySections(apiKey, primary);
      const primaryAnchors = primary.filter((location): location is Anchor => typeof location !== "string");
      const metrics = validateGeometry(points, primaryAnchors.length ? primaryAnchors : coordinateAnchors, true, governorate, allowOutsideServiceArea);
      attempts.push({ strategy: "sectional_all_constraints", removedConstraints: [], accepted: metrics.accepted, metrics });
      if (metrics.accepted) {
        accepted.push({ strategy: "sectional_all_constraints", locations: primary, removedConstraints: [], points, metrics });
      }
    } catch (error) {
      attempts.push({ strategy: "sectional_all_constraints", removedConstraints: [], error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const candidate of candidates) {
    const signature = candidate.locations.map(locationValue).join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);
    try {
      const response = candidate.precomputedPoints
        ? { points: candidate.precomputedPoints, status: "OK" }
        : await googleRoute(apiKey, candidate.locations);
      const candidateAnchors = candidate.validationAnchors
        ?? candidate.locations.filter((location): location is Anchor => typeof location !== "string");
      const metrics = validateGeometry(response.points, candidateAnchors.length ? candidateAnchors : coordinateAnchors, candidate.locations.length > 2, governorate, allowOutsideServiceArea);
      attempts.push({ strategy: candidate.strategy, removedConstraints: candidate.removedConstraints, accepted: metrics.accepted, metrics });
      if (metrics.accepted) accepted.push({ ...candidate, locations: candidate.evidenceLocations ?? candidate.locations, points: response.points, metrics });
      // The fully constrained result is always preferred when valid.
      if (metrics.accepted && candidate.strategy === "all_ordered_constraints") break;
    } catch (error) {
      attempts.push({ strategy: candidate.strategy, removedConstraints: candidate.removedConstraints, error: error instanceof Error ? error.message : String(error) });
    }
    await sleep(100);
  }
  if (!accepted.length) {
    const reasons = attempts.map((attempt) => {
      if ("error" in attempt) return `${attempt.strategy}: ${String(attempt.error)}`;
      const metrics = attempt.metrics as { warnings?: string[] } | undefined;
      return `${attempt.strategy}: ${(metrics?.warnings ?? ["quality rejected"]).join(", ")}`;
    }).join("; ");
    throw new Error(`No Google candidate passed quality gates. ${reasons}`);
  }
  accepted.sort((a, b) => {
    if (b.locations.length !== a.locations.length) return b.locations.length - a.locations.length;
    const aRatio = a.metrics.detourRatio ?? 1;
    const bRatio = b.metrics.detourRatio ?? 1;
    return aRatio - bRatio;
  });
  return { ...accepted[0], attempts };
}

async function saveGeometry(line: LineRow, geometry: { type: "LineString"; coordinates: LngLat[] }, metrics: Record<string, unknown>, licenseReference: string, confidence: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const versionResult = await client.query<{ next: number }>(
      "SELECT COALESCE(MAX(version), 0) + 1 AS next FROM route_geometry_versions WHERE transit_line_id = $1",
      [line.id],
    );
    const inserted = await client.query<{ id: string }>(`
      INSERT INTO route_geometry_versions
        (transit_line_id, version, geometry, source, status, quality_score, confidence_score, metrics, evidence, created_by, accepted_at)
      VALUES ($1, $2, $3::jsonb, 'google_directions_licensed_study', CASE WHEN $4::real >= 0.9::real THEN 'accepted' ELSE 'candidate' END, $4::real, $4::real, $5::jsonb, $6::jsonb, 'bulk_google_regenerator', CASE WHEN $4::real >= 0.9::real THEN NOW() ELSE NULL END)
      RETURNING id
    `, [line.id, Number(versionResult.rows[0].next), JSON.stringify(geometry), confidence, JSON.stringify(metrics), JSON.stringify({
      provider: "Google Directions API",
      mode: "driving",
      polylinePrecision: 5,
      permanentStoragePermissionReference: licenseReference,
      generatedAt: new Date().toISOString(),
    })]);
    if (confidence < 0.9) {
      await client.query("COMMIT");
      return;
    }
    await client.query(`
      UPDATE transit_lines SET
        route_path = $2::jsonb,
        active_geometry_version_id = $3,
        confidence_score = $4::real,
        route_status = 'active'::route_status,
        route_quality = $5::jsonb,
        verified_at = NOW(),
        needs_review_reason = NULL,
        updated_at = NOW()
      WHERE id = $1
    `, [line.id, JSON.stringify(geometry), inserted.rows[0].id, confidence, JSON.stringify({
      qualityScore: confidence,
      confidenceScore: confidence,
      confidenceLevel: confidence >= 0.9 ? "high" : "medium",
      source: "google_directions_licensed_study",
      generatedAt: new Date().toISOString(),
      metrics,
      warnings: [],
    })]);
    if (metrics.selectedStrategy === "locally_cleaned_stop_chain"
      || (Array.isArray(metrics.preRemovedConstraints) && metrics.preRemovedConstraints.length > 0)) {
      const selected = Array.isArray(metrics.selectedAnchors) ? metrics.selectedAnchors as Anchor[] : [];
      const cleanedViaStops = selected.slice(1, -1)
        .map((anchor) => String(anchor.name ?? "").replace(/,\s*[^,]+,\s*Egypt$/i, "").trim())
        .filter(Boolean);
      await client.query("UPDATE transit_lines SET via_stops=$2::text[] WHERE id=$1", [line.id, cleanedViaStops]);
      await client.query("DELETE FROM route_repair_anchors WHERE transit_line_id=$1 AND direction='forward'", [line.id]);
      for (let sequence = 0; sequence < selected.length; sequence++) {
        const anchor = selected[sequence];
        await client.query(`
          INSERT INTO route_repair_anchors
            (transit_line_id, sequence, direction, name, lat, lng, source, required, confidence_score, anchor_type, created_by)
          VALUES ($1,$2,'forward',$3,$4,$5,'cleaned_named_corridor',TRUE,$6,'corridor','bulk_google_regenerator')
        `, [line.id, sequence, anchor.name ?? "", anchor.lat, anchor.lng, confidence]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const apiKey = process.env.GOOGLE_DIRECTIONS_API_KEY?.trim();
  if (!apiKey) throw new Error("Set GOOGLE_DIRECTIONS_API_KEY to a backend-restricted key");
  const licenseReference = arg("acknowledge-google-storage-license")?.trim();
  if (!licenseReference) {
    throw new Error("Permanent storage is disabled. Pass --acknowledge-google-storage-license=<email/agreement-reference> only when your written Google permission covers it.");
  }
  const dryRun = process.argv.includes("--dry-run");
  const stopChainAuditOnly = process.argv.includes("--stop-chain-audit-only");
  const reasonableStopChainsOnly = process.argv.includes("--reasonable-stop-chains-only");
  const previousStopChainFailuresOnly = process.argv.includes("--previous-stop-chain-failures-only");
  const suspiciousStopChainsOnly = process.argv.includes("--suspicious-stop-chains-only");
  const rejectedStopChainsOnly = process.argv.includes("--rejected-stop-chains-only");
  const structuredStopsOnly = process.argv.includes("--structured-stops-only");
  const withoutStructuredStops = process.argv.includes("--without-structured-stops");
  const allowCoherentOutbound = process.argv.includes("--allow-coherent-outbound");
  const onlyUnverified = process.argv.includes("--only-unverified");
  const requireAnchorTrail = process.argv.includes("--require-anchor-trail");
  const auditFailedOnly = process.argv.includes("--audit-failed-only");
  const sectionalFallback = process.argv.includes("--sectional-fallback");
  const osmNameIndex = await loadOsmNameIndex(arg("osm-name-index") || process.env.OSM_NAME_INDEX);
  const lineId = arg("line-id");
  const governorate = arg("governorate")?.trim();
  const offset = integerArg("offset", 0);
  const limit = integerArg("limit", Number.MAX_SAFE_INTEGER);
  const rows = await pool.query<LineRow>(`
    SELECT l.id, l.line_number, l.name_en, l.from_area, l.to_area, l.governorate,
           l.stops, l.route_path, l.data_source, l.via_stops, t.name_en AS transport_name
    FROM transit_lines l
    JOIN transport_types t ON t.id = l.transport_type_id
    LEFT JOIN route_geometry_versions active_v ON active_v.id = l.active_geometry_version_id
    WHERE l.is_active = TRUE
      AND ($1::uuid IS NULL OR l.id = $1::uuid)
      AND ($2::text IS NULL OR LOWER(l.governorate) = LOWER($2::text))
      AND ($3::boolean = FALSE OR NOT COALESCE((
        active_v.source = 'google_directions_licensed_study'
        AND active_v.confidence_score >= 0.899
      ), FALSE) OR ($4::boolean = TRUE AND jsonb_array_length(COALESCE(active_v.metrics->'selectedAnchors', '[]'::jsonb)) < 2))
      AND ($5::boolean = FALSE OR l.needs_review_reason LIKE 'Independent route audit failed:%')
    ORDER BY l.governorate, t.name_en, l.line_number NULLS LAST, l.id
  `, [lineId || null, governorate || null, onlyUnverified, requireAnchorTrail, auditFailedOnly]);

  let eligibleRows = rows.rows;
  if (structuredStopsOnly) eligibleRows = eligibleRows.filter((line) => Array.isArray(line.stops) && line.stops.length >= 2);
  if (withoutStructuredStops) eligibleRows = eligibleRows.filter((line) => !Array.isArray(line.stops) || line.stops.length < 2);
  if (reasonableStopChainsOnly) {
    const stopAudit = JSON.parse(await readFile(STOP_CHAIN_OUTPUT, "utf8")) as {
      routes?: Array<{ lineId?: string; status?: string; suspiciousCount?: number; largeGapCount?: number }>;
    };
    const reasonableIds = new Set((stopAudit.routes ?? [])
      .filter((route) => route.status === "stop_chain_audited" && route.suspiciousCount === 0 && route.largeGapCount === 0)
      .map((route) => route.lineId)
      .filter((lineId): lineId is string => Boolean(lineId)));
    eligibleRows = eligibleRows.filter((line) => reasonableIds.has(line.id));
  }
  if (previousStopChainFailuresOnly) {
    const stopAudit = JSON.parse(await readFile(STOP_CHAIN_OUTPUT, "utf8")) as {
      routes?: Array<{ lineId?: string; status?: string }>;
    };
    const failedIds = new Set((stopAudit.routes ?? [])
      .filter((route) => route.status === "failed")
      .map((route) => route.lineId)
      .filter((lineId): lineId is string => Boolean(lineId)));
    eligibleRows = eligibleRows.filter((line) => failedIds.has(line.id));
  }
  if (suspiciousStopChainsOnly) {
    const stopAudit = JSON.parse(await readFile(STOP_CHAIN_OUTPUT, "utf8")) as {
      routes?: Array<{ lineId?: string; status?: string; suspiciousCount?: number; outsideCount?: number }>;
    };
    const suspiciousIds = new Set((stopAudit.routes ?? [])
      .filter((route) => route.status === "stop_chain_audited" && Number(route.suspiciousCount) > 0 && Number(route.outsideCount ?? 0) === 0)
      .map((route) => route.lineId)
      .filter((lineId): lineId is string => Boolean(lineId)));
    eligibleRows = eligibleRows.filter((line) => suspiciousIds.has(line.id));
  }
  if (rejectedStopChainsOnly) {
    const stopAudit = JSON.parse(await readFile(STOP_CHAIN_OUTPUT, "utf8")) as {
      routes?: Array<{ lineId?: string; status?: string }>;
    };
    const rejectedIds = new Set((stopAudit.routes ?? [])
      .filter((route) => route.status === "stop_chain_rejected")
      .map((route) => route.lineId)
      .filter((lineId): lineId is string => Boolean(lineId)));
    eligibleRows = eligibleRows.filter((line) => rejectedIds.has(line.id));
  }
  const selected = eligibleRows.slice(offset, offset + limit);
  const audit: Record<string, unknown>[] = [];
  let saved = 0;
  let failed = 0;
  let protectedGuideway = 0;
  console.log(`Loaded ${rows.rows.length} active lines; processing ${selected.length} sequentially.`);

  for (let index = 0; index < selected.length; index++) {
    const line = selected[index];
    const label = `${line.transport_name} ${line.line_number || line.name_en || line.id}`;
    if (FIXED_GUIDEWAY.test(line.transport_name)) {
      protectedGuideway++;
      audit.push({ lineId: line.id, label, status: "protected_fixed_guideway", reason: "Preserved rail/metro/monorail/tram alignment; driving geometry is invalid for guideway transit." });
      console.log(`[${index + 1}/${selected.length}] PROTECTED ${label}`);
      continue;
    }

    try {
      const prepared = await anchorsForLine(line);
      const namedCorridor = (line.via_stops ?? []).map((name) => `${name}, ${line.governorate}, Egypt`);
      const onlyLegacyPathEndpoints = prepared.anchors.length > 0
        && prepared.anchors.every((anchor) => anchor.source === "endpoint_only");
      let locations: GoogleLocation[];
      if (onlyLegacyPathEndpoints) {
        // Old generated paths frequently terminate at the Cairo default
        // center, sometimes at both ends. Those points are evidence of a
        // failed generator, not transit anchors, so resolve the actual route
        // endpoint names in the ordered city context instead.
        locations = [
          `${line.from_area}, ${line.governorate}, Egypt`,
          ...namedCorridor,
          `${line.to_area}, ${line.governorate}, Egypt`,
        ];
      } else if (prepared.anchors.length >= 2) {
        locations = prepared.anchors.length === 2 && namedCorridor.length
          ? [prepared.anchors[0], ...namedCorridor, prepared.anchors[1]]
          : prepared.anchors;
      } else {
        locations = [
          `${line.from_area}, ${line.governorate}, Egypt`,
          ...namedCorridor,
          `${line.to_area}, ${line.governorate}, Egypt`,
        ];
      }
      if (locations.length < 2) throw new Error("Fewer than two usable route locations");
      let qualityAnchors = prepared.anchors.length >= 2 && !onlyLegacyPathEndpoints ? prepared.anchors : [];
      if (locations.some((location) => typeof location === "string")) {
        qualityAnchors = await resolveNamedLocations(apiKey, locations, line.governorate);
        qualityAnchors = contextualizeNamedAnchors(qualityAnchors, line.governorate, osmNameIndex);
        locations = qualityAnchors;
        await sleep(100);
      }
      const bounds = governorateBounds(line.governorate);
      const preRemovedConstraints: string[] = [];
      if (bounds && qualityAnchors.length > 2) {
        qualityAnchors = qualityAnchors.filter((anchor, anchorIndex) => {
          const outside = anchor.lng < bounds.minLng || anchor.lng > bounds.maxLng || anchor.lat < bounds.minLat || anchor.lat > bounds.maxLat;
          const agriculturalRoadDescriptor = /زراع|agricultur/i.test(anchor.name);
          const remove = outside && agriculturalRoadDescriptor && anchorIndex > 0 && anchorIndex < qualityAnchors.length - 1;
          if (remove) preRemovedConstraints.push(anchor.name);
          return !remove;
        });
        locations = qualityAnchors;
      }
      const outbound = coherentOutboundChain(qualityAnchors, line.governorate);
      if (outbound.outsideCount > 0 && (!allowCoherentOutbound || !outbound.allowed)) {
        if (stopChainAuditOnly) {
          const chain = analyzeAnchorChain(qualityAnchors);
          audit.push({ lineId: line.id, label, status: "stop_chain_rejected", reason: "isolated_outside_resolution",
            coherentOutbound: false, outsideCount: outbound.outsideCount, outsideIndexes: outbound.outsideIndexes, ...chain });
          console.log(`[${index + 1}/${selected.length}] REJECTED CHAIN ${label} (${outbound.outsideCount} isolated outside point(s))`);
          continue;
        }
        throw new Error(`Resolved ${outbound.outsideCount} outside-${line.governorate} point(s), but they do not form a coherent endpoint section`);
      }
      if (stopChainAuditOnly) {
        const chain = analyzeAnchorChain(qualityAnchors);
        audit.push({ lineId: line.id, label, status: "stop_chain_audited", preparedWarnings: prepared.warnings,
          coherentOutbound: outbound.allowed, outsideCount: outbound.outsideCount, outsideIndexes: outbound.outsideIndexes, ...chain });
        console.log(`[${index + 1}/${selected.length}] CHAIN ${label} (${chain.anchorCount} points, ${chain.suspiciousCount} suspicious, max gap ${chain.maximumGapKm.toFixed(1)} km)`);
        continue;
      }
      const solved = await solveWithConstraintRetries(apiKey, locations, qualityAnchors, line.governorate, sectionalFallback, outbound.allowed);
      const metrics = solved.metrics;
      const warnings = [...prepared.warnings, ...metrics.warnings];
      if (!metrics.accepted) throw new Error(warnings.join("; "));
      const endpointOnly = prepared.anchors.length === 2 && prepared.anchors[0].source === "endpoint_only" && namedCorridor.length === 0;
      const textOnly = prepared.anchors.length < 2;
      const confidence = solved.strategy === "endpoints_only"
        ? (textOnly ? 0.78 : 0.82)
        : solved.strategy === "locally_cleaned_stop_chain"
          ? (Number(solved.retentionRatio ?? 0) >= 0.7 ? 0.92 : 0.9)
        : solved.strategy === "thinned_ordered_corridor"
          ? 0.94
        : solved.strategy === "simplified_corridor_shape"
          ? 0.94
        : solved.strategy === "monotonic_corridor_subset"
          ? (Number(solved.retentionRatio ?? 0) >= 0.65 ? 0.92 : 0.9)
        : solved.strategy === "sectional_all_constraints"
          ? 0.95
          : solved.strategy === "coordinate_constraints_only"
          ? 0.88
          : solved.strategy === "leave_one_constraint_out"
            ? 0.92
            : endpointOnly
              ? 0.82
              : textOnly && namedCorridor.length === 0
                ? 0.78
                : textOnly
                  ? 0.9
                  : 0.96;
      if (!dryRun) {
        await saveGeometry(line, { type: "LineString", coordinates: solved.points }, {
          ...metrics, anchorCount: prepared.anchors.length, namedCorridorCount: namedCorridor.length, pointCount: solved.points.length,
          selectedStrategy: solved.strategy, removedConstraints: solved.removedConstraints, attempts: solved.attempts,
          constraintRetentionRatio: solved.retentionRatio,
          coherentOutbound: outbound.allowed,
          preRemovedConstraints,
          selectedAnchors: solved.locations
            .filter((location): location is Anchor => typeof location !== "string")
            .map((anchor) => ({ name: anchor.name, lat: anchor.lat, lng: anchor.lng, source: anchor.source })),
          anchorSources: [...new Set(prepared.anchors.map((anchor) => anchor.source))],
        }, licenseReference, confidence);
      }
      saved++;
      audit.push({ lineId: line.id, label, status: dryRun ? "validated" : "saved", confidence, warnings, anchorCount: prepared.anchors.length, namedCorridorCount: namedCorridor.length, coherentOutbound: outbound.allowed, outsideCount: outbound.outsideCount, pointCount: solved.points.length, strategy: solved.strategy, retentionRatio: solved.retentionRatio, removedConstraints: solved.removedConstraints, attempts: solved.attempts, metrics });
      console.log(`[${index + 1}/${selected.length}] ${dryRun ? "VALID" : "SAVED"} ${label} (${solved.points.length} points, ${prepared.anchors.length} coordinate + ${namedCorridor.length} named anchors, ${solved.strategy})`);
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      audit.push({ lineId: line.id, label, status: "failed", error: message });
      console.error(`[${index + 1}/${selected.length}] FAILED ${label}: ${message}`);
    }
    await sleep(100);
  }

  const outputPath = stopChainAuditOnly ? STOP_CHAIN_OUTPUT : OUTPUT;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    provider: "Google Directions API",
    storagePermissionReference: licenseReference,
    dryRun,
    stopChainAuditOnly,
    totals: { selected: selected.length, saved, failed, protectedGuideway },
    routes: audit,
  }, null, 2));
  console.log(`Done. saved=${saved}, failed=${failed}, protectedGuideway=${protectedGuideway}`);
  console.log(`Audit: ${outputPath}`);
  if (failed > 0) process.exitCode = 2;
}

main().finally(async () => pool.end()).catch((error) => {
  console.error(error instanceof Error && error.message ? error.message : error);
  process.exitCode = 1;
});
