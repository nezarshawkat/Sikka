import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@workspace/db";

type LngLat = [number, number];
type Stop = { name: string; lat: number; lng: number };
type OsmWay = {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | LngLat)[];
};
type OsmDocument = { elements: OsmWay[] };

const REPORT_PATH = path.resolve(process.cwd(), "scripts/generated/fixed-guideway-regeneration-audit.json");
const GOOGLE_DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json";
const REQUIRED_LICENSE_ACK = "email-study-permission-confirmed-2026-07-02";

function arg(name: string): string | undefined {
  const exact = process.argv.indexOf(`--${name}`);
  if (exact >= 0) return process.argv[exact + 1];
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
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

function decodePolyline5(encoded: string): LngLat[] {
  const output: LngLat[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    const decode = () => {
      let result = 0;
      let shift = 0;
      let byte = 0;
      do {
        if (index >= encoded.length) throw new Error("Truncated Google polyline");
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      return (result & 1) ? ~(result >> 1) : result >> 1;
    };
    latitude += decode();
    longitude += decode();
    output.push([longitude / 1e5, latitude / 1e5]);
  }
  return output;
}

function nearestPathIndex(pathPoints: LngLat[], point: LngLat, minimumIndex = 0): { index: number; km: number } {
  let bestIndex = minimumIndex;
  let bestKm = Number.POSITIVE_INFINITY;
  for (let index = minimumIndex; index < pathPoints.length; index++) {
    const km = haversineKm(pathPoints[index], point);
    if (km < bestKm) {
      bestKm = km;
      bestIndex = index;
    }
  }
  return { index: bestIndex, km: bestKm };
}

function snapOrderedStops(pathPoints: LngLat[], stops: Stop[], maximumKm: number): Stop[] {
  let minimumIndex = 0;
  return stops.map((stop) => {
    const nearest = nearestPathIndex(pathPoints, [stop.lng, stop.lat], minimumIndex);
    if (nearest.km > maximumKm) {
      throw new Error(`${stop.name} is ${nearest.km.toFixed(2)} km from the selected rail alignment`);
    }
    minimumIndex = nearest.index;
    const [lng, lat] = pathPoints[nearest.index];
    return { name: stop.name, lat, lng };
  });
}

function geometryKey(point: LngLat): string {
  return `${point[0].toFixed(7)},${point[1].toFixed(7)}`;
}

function wayPoints(way: OsmWay): LngLat[] {
  return (way.geometry ?? []).map((point) => Array.isArray(point)
    ? [Number(point[0]), Number(point[1])]
    : [Number(point.lon), Number(point.lat)]);
}

function monorailWays(document: OsmDocument, line: "east" | "west"): OsmWay[] {
  return document.elements.filter((element) => {
    if (element.type !== "way" || element.tags?.railway !== "monorail" || !element.geometry?.length) return false;
    if (element.tags.service) return false;
    const inBounds = wayPoints(element).every(([lon, lat]) => line === "east"
      ? lon >= 31.315 && lon <= 31.772 && lat >= 29.99 && lat <= 30.08
      : lon >= 30.83 && lon <= 31.21 && lat >= 29.90 && lat <= 30.08);
    return inBounds && !String(element.tags.name ?? "").toLowerCase().includes("minimetro");
  });
}

function simpleTrackComponents(ways: OsmWay[]): LngLat[][] {
  const adjacency = new Map<string, Set<string>>();
  const coordinates = new Map<string, LngLat>();
  for (const way of ways) {
    const geometry = wayPoints(way);
    for (let index = 1; index < geometry.length; index++) {
      const a = geometryKey(geometry[index - 1]);
      const b = geometryKey(geometry[index]);
      coordinates.set(a, geometry[index - 1]);
      coordinates.set(b, geometry[index]);
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a)!.add(b);
      adjacency.get(b)!.add(a);
    }
  }

  const visited = new Set<string>();
  const result: LngLat[][] = [];
  for (const initial of coordinates.keys()) {
    if (visited.has(initial)) continue;
    const stack = [initial];
    const component: string[] = [];
    visited.add(initial);
    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    if (component.length < 50) continue;
    const endpoints = component.filter((key) => adjacency.get(key)?.size === 1);
    if (endpoints.length !== 2 || component.some((key) => (adjacency.get(key)?.size ?? 0) > 2)) continue;
    const ordered: LngLat[] = [];
    let previous: string | undefined;
    let current: string | undefined = endpoints[0];
    while (current) {
      ordered.push(coordinates.get(current)!);
      const next: string | undefined = [...(adjacency.get(current) ?? [])].find((candidate) => candidate !== previous);
      previous = current;
      current = next;
    }
    result.push(ordered);
  }
  return result;
}

function shortestRailPath(ways: OsmWay[], start: LngLat, end: LngLat): LngLat[] {
  const adjacency = new Map<string, { key: string; km: number }[]>();
  const coordinates = new Map<string, LngLat>();
  const add = (a: LngLat, b: LngLat) => {
    const aKey = geometryKey(a);
    const bKey = geometryKey(b);
    coordinates.set(aKey, a);
    coordinates.set(bKey, b);
    if (!adjacency.has(aKey)) adjacency.set(aKey, []);
    adjacency.get(aKey)!.push({ key: bKey, km: haversineKm(a, b) });
  };
  for (const way of ways) {
    const points = wayPoints(way);
    for (let index = 1; index < points.length; index++) {
      add(points[index - 1], points[index]);
      add(points[index], points[index - 1]);
    }
  }
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const initial of coordinates.keys()) {
    if (visited.has(initial)) continue;
    const stack = [initial];
    const component: string[] = [];
    visited.add(initial);
    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      for (const edge of adjacency.get(current) ?? []) {
        if (!visited.has(edge.key)) {
          visited.add(edge.key);
          stack.push(edge.key);
        }
      }
    }
    components.push(component);
  }
  const nearestIn = (point: LngLat, keys: string[]) => keys
    .reduce((best, key) => haversineKm(point, coordinates.get(key)!) < best.km
      ? { key, km: haversineKm(point, coordinates.get(key)!) }
      : best, { key: "", km: Number.POSITIVE_INFINITY });
  const selected = components
    .map((keys) => ({ keys, source: nearestIn(start, keys), target: nearestIn(end, keys) }))
    .sort((a, b) => a.source.km + a.target.km - b.source.km - b.target.km)[0];
  const source = selected.source;
  const target = selected.target;
  if (source.km > 0.25 || target.km > 0.25) throw new Error("LRT branch endpoints do not match the OSM rail graph");

  const distances = new Map<string, number>([[source.key, 0]]);
  const previous = new Map<string, string>();
  const pending = new Set(selected.keys);
  while (pending.size) {
    let current = "";
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const key of pending) {
      const distance = distances.get(key) ?? Number.POSITIVE_INFINITY;
      if (distance < currentDistance) {
        current = key;
        currentDistance = distance;
      }
    }
    if (!current || current === target.key) break;
    pending.delete(current);
    for (const edge of adjacency.get(current) ?? []) {
      if (!pending.has(edge.key)) continue;
      const candidate = currentDistance + edge.km;
      if (candidate < (distances.get(edge.key) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.key, candidate);
        previous.set(edge.key, current);
      }
    }
  }
  if (!distances.has(target.key)) throw new Error("No continuous OSM LRT branch path was found");
  const reversed: LngLat[] = [];
  let current: string | undefined = target.key;
  while (current) {
    reversed.push(coordinates.get(current)!);
    if (current === source.key) break;
    current = previous.get(current);
  }
  return reversed.reverse();
}

function lrtKnowledgeBranchPath(document: OsmDocument): LngLat[] {
  const ways = document.elements.filter((way) => way.tags?.["name:en"] === "Cairo LRT"
    && way.tags?.railway === "light_rail"
    && !way.tags?.service
    && wayPoints(way).length > 1);
  return shortestRailPath(ways, [31.71604, 30.17516], [31.69155, 30.23069]);
}

function orient(points: LngLat[], start: LngLat, end: LngLat): LngLat[] {
  const forward = haversineKm(points[0], start) + haversineKm(points[points.length - 1], end);
  const reverse = haversineKm(points[points.length - 1], start) + haversineKm(points[0], end);
  return forward <= reverse ? points : [...points].reverse();
}

function selectTrack(document: OsmDocument, line: "east" | "west", start: LngLat, end: LngLat): LngLat[] {
  const components = simpleTrackComponents(monorailWays(document, line));
  if (!components.length) throw new Error(`No continuous ${line} monorail track found`);
  const ranked = components
    .map((points) => orient(points, start, end))
    .map((points) => ({ points, endpointError: haversineKm(points[0], start) + haversineKm(points.at(-1)!, end) }))
    .sort((a, b) => a.endpointError - b.endpointError);
  const selected = ranked[0];
  if (selected.endpointError > 1) throw new Error(`${line} monorail endpoints miss the alignment by ${selected.endpointError.toFixed(2)} km`);
  return selected.points;
}

const EAST_REFERENCE_STOPS: Stop[] = [
  { name: "Cairo Stadium", lat: 30.0715785, lng: 31.3176433 },
  { name: "Hisham Barakat", lat: 30.0634980, lng: 31.3218683 },
  { name: "Al-Azhar University", lat: 30.0537765, lng: 31.3247217 },
  { name: "Seventh District", lat: 30.0437679, lng: 31.3309116 },
  { name: "El-Mosheer Ahmed Ismail", lat: 30.0454520, lng: 31.3463929 },
  { name: "Jehan El-Sadat", lat: 30.0392354, lng: 31.3554780 },
  { name: "Al-Mousheer Tantawy", lat: 30.0191612, lng: 31.3833071 },
  { name: "One Ninety", lat: 30.0162766, lng: 31.4089713 },
  { name: "Air Force Hospital", lat: 30.0163218, lng: 31.4338853 },
  { name: "Al-Nargis", lat: 30.0255253, lng: 31.4599160 },
  { name: "Investors", lat: 30.0254039, lng: 31.4906578 },
  { name: "Al-Lotus", lat: 30.0132909, lng: 31.5195947 },
  { name: "Golden Square", lat: 30.0270446, lng: 31.5330388 },
  { name: "Beit Al-Watan", lat: 30.0268383, lng: 31.5605902 },
  { name: "Al-Fattah Al-Alim Mosque", lat: 30.0247722, lng: 31.5987834 },
  { name: "R1 District", lat: 30.0169889, lng: 31.6310120 },
  { name: "R2 District", lat: 30.0182349, lng: 31.6633656 },
  { name: "Business District", lat: 30.0172514, lng: 31.6891476 },
  { name: "Arts and Culture City", lat: 30.0080352, lng: 31.7255828 },
  { name: "Government District", lat: 30.0079394, lng: 31.7448129 },
  { name: "Masr Mosque", lat: 29.9952755, lng: 31.7500573 },
  { name: "Justice City", lat: 30.0059410, lng: 31.7701100 },
];

const WEST_STATION_NAMES = [
  "New October", "Ahram Canadian University", "Sadat", "6th of October University",
  "Engineers Syndicate", "Mall of Egypt", "Sheikh Zayed City", "Alexandria Road",
  "Mansouriya", "Mariouteya", "Ring Road", "Bashteel", "Wadi El-Nile",
];

function westStationReferences(document: OsmDocument, westPath: LngLat[]): Stop[] {
  const centers: LngLat[] = [];
  for (const way of monorailWays(document, "west")) {
    const isStationStructure = way.tags?.tunnel === "building_passage"
      || (way.tags?.tunnel === "yes" && way.geometry!.some(({ lon }) => lon > 31.16 && lon < 31.18));
    if (!isStationStructure) continue;
    const points = wayPoints(way);
    const point = points[Math.floor(points.length / 2)];
    if (centers.every((candidate) => haversineKm(candidate, point) > 0.08)) centers.push(point);
  }
  centers.sort((a, b) => nearestPathIndex(westPath, a).index - nearestPathIndex(westPath, b).index);
  if (centers.length !== WEST_STATION_NAMES.length) {
    throw new Error(`Expected 13 West monorail station structures, found ${centers.length}`);
  }
  return centers.map(([lng, lat], index) => ({ name: WEST_STATION_NAMES[index], lat, lng }));
}

const LRT_CAPITAL_STOPS: Stop[] = [
  { name: "Adly Mansour", lat: 30.146457, lng: 31.421320 },
  { name: "El Obour", lat: 30.162973, lng: 31.481647 },
  { name: "Future", lat: 30.173125, lng: 31.554193 },
  { name: "El Shorouk", lat: 30.179547, lng: 31.605881 },
  { name: "New Heliopolis", lat: 30.184027, lng: 31.652721 },
  { name: "Badr", lat: 30.175183, lng: 31.715848 },
  { name: "El Robaikey", lat: 30.166517, lng: 31.752409 },
  { name: "Hadayek Al Assema", lat: 30.136704, lng: 31.806826 },
  { name: "Capital Airport", lat: 30.075929, lng: 31.782516 },
  { name: "Arts and Culture City", lat: 30.013776, lng: 31.725019 },
];

const LRT_KNOWLEDGE_STOPS: Stop[] = [
  ...LRT_CAPITAL_STOPS.slice(0, 6),
  { name: "Industrial Park", lat: 30.2039311, lng: 31.7155766 },
  { name: "Knowledge City", lat: 30.2306896, lng: 31.6915467 },
];

async function googleLrtCapitalPath(apiKey: string): Promise<LngLat[]> {
  const url = new URL(GOOGLE_DIRECTIONS_URL);
  url.searchParams.set("origin", "30.146457,31.421320");
  url.searchParams.set("destination", "30.013776,31.725019");
  url.searchParams.set("mode", "transit");
  url.searchParams.set("transit_mode", "rail");
  url.searchParams.set("alternatives", "true");
  url.searchParams.set("key", apiKey);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Google Transit HTTP ${response.status}`);
  const body = await response.json() as any;
  if (body.status !== "OK") throw new Error(`Google Transit: ${body.status} ${body.error_message ?? ""}`.trim());
  for (const route of body.routes ?? []) {
    for (const leg of route.legs ?? []) {
      for (const step of leg.steps ?? []) {
        const details = step.transit_details;
        if (details?.line?.short_name === "LRT" && details?.line?.name === "LRT Route") {
          if (details.departure_stop?.name !== "Adly Mansour" || details.arrival_stop?.name !== "Arts and Culture City") continue;
          const points = decodePolyline5(step.polyline?.points ?? "");
          if (points.length < 500) throw new Error("Google LRT transit polyline is unexpectedly sparse");
          return points;
        }
      }
    }
  }
  throw new Error("Google did not return the real named LRT transit step");
}

type LineUpdate = {
  lineNumber: string;
  name: string;
  from: string;
  to: string;
  points: LngLat[];
  stops: Stop[];
  source: string;
  confidence: number;
  evidence: Record<string, unknown>;
};

async function saveAcceptedLine(update: LineUpdate): Promise<{ id: string; version: number }> {
  const lineResult = await pool.query<{ id: string }>(
    `SELECT id FROM transit_lines WHERE line_number = $1 ORDER BY created_at ASC LIMIT 1`,
    [update.lineNumber],
  );
  if (!lineResult.rows[0]) throw new Error(`Transit line ${update.lineNumber} does not exist`);
  const id = lineResult.rows[0].id;
  const geometry = { type: "LineString", coordinates: update.points };
  const lengthKm = pathLengthKm(update.points);

  await pool.query("BEGIN");
  try {
    const versionResult = await pool.query<{ version: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM route_geometry_versions WHERE transit_line_id = $1`,
      [id],
    );
    const version = Number(versionResult.rows[0].version);
    await pool.query(
      `UPDATE route_geometry_versions SET status = 'superseded' WHERE transit_line_id = $1 AND status = 'accepted'`,
      [id],
    );
    const inserted = await pool.query<{ id: string }>(`
      INSERT INTO route_geometry_versions
        (transit_line_id, version, geometry, source, status, quality_score, confidence_score,
         metrics, evidence, created_by, accepted_at)
      VALUES ($1, $2, $3::jsonb, $4, 'accepted', $5, $5, $6::jsonb, $7::jsonb,
              'codex_fixed_guideway_regenerator', NOW())
      RETURNING id
    `, [id, version, JSON.stringify(geometry), update.source, update.confidence,
      JSON.stringify({ lengthKm, coordinateCount: update.points.length, stopCount: update.stops.length }),
      JSON.stringify(update.evidence)]);
    const geometryVersionId = inserted.rows[0].id;
    await pool.query(`
      UPDATE transit_lines
      SET name_en = $2, from_area = $3, to_area = $4, stops = $5::jsonb, route_path = $6::jsonb,
          data_source = $7, source_priority = 100, confidence_score = $8, route_status = 'active',
          geometry_locked = TRUE, active_geometry_version_id = $9, has_fixed_stops = TRUE,
          route_direction = 'forward', verified_at = NOW(), last_confirmed_at = NOW(),
          needs_review_reason = NULL,
          route_quality = $10::jsonb, updated_at = NOW(), is_active = TRUE
      WHERE id = $1
    `, [id, update.name, update.from, update.to, JSON.stringify(update.stops), JSON.stringify(geometry),
      update.source, update.confidence, geometryVersionId,
      JSON.stringify({ qualityScore: update.confidence, confidenceScore: update.confidence, confidenceLevel: "high",
        source: update.source, generatedAt: new Date().toISOString(),
        metrics: { lengthKm, coordinateCount: update.points.length, stopCount: update.stops.length }, warnings: [] })]);
    await pool.query(`DELETE FROM route_repair_anchors WHERE transit_line_id = $1`, [id]);
    for (let sequence = 0; sequence < update.stops.length; sequence++) {
      const stop = update.stops[sequence];
      await pool.query(`
        INSERT INTO route_repair_anchors
          (transit_line_id, sequence, direction, name, lat, lng, source, required,
           confidence_score, anchor_type, created_by)
        VALUES ($1, $2, 'forward', $3, $4, $5, $6, TRUE, $7, 'station',
                'codex_fixed_guideway_regenerator')
      `, [id, sequence, stop.name, stop.lat, stop.lng, update.source, update.confidence]);
    }
    await pool.query("COMMIT");
    return { id, version };
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

async function retireFakeMonorailSegments(): Promise<number> {
  const result = await pool.query(`
    UPDATE transit_lines
    SET is_active = FALSE, route_status = 'inactive', route_path = NULL,
        active_geometry_version_id = NULL, geometry_locked = FALSE,
        needs_review_reason = 'Retired: obsolete synthetic segment replaced by canonical station-based monorail line',
        updated_at = NOW()
    WHERE line_number ~ '^MR-[EW]-[0-9]+$'
  `);
  return result.rowCount ?? 0;
}

async function main(): Promise<void> {
  const osmPath = arg("osm-monorail-json");
  const osmLrtPath = arg("osm-lrt-json");
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!osmPath) throw new Error("Pass --osm-monorail-json=<Overpass JSON with monorail way geometry>");
  if (!osmLrtPath) throw new Error("Pass --osm-lrt-json=<OSM JSON with Cairo LRT way geometry>");
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is required for the real LRT transit step");
  if (arg("acknowledge-google-storage-license") !== REQUIRED_LICENSE_ACK) {
    throw new Error(`Pass --acknowledge-google-storage-license=${REQUIRED_LICENSE_ACK}`);
  }
  const osm = JSON.parse((await readFile(path.resolve(osmPath), "utf8")).replace(/^\uFEFF/, "")) as OsmDocument;
  const osmLrt = JSON.parse((await readFile(path.resolve(osmLrtPath), "utf8")).replace(/^\uFEFF/, "")) as OsmDocument;

  const eastPath = selectTrack(osm, "east", [31.3176433, 30.0715785], [31.7701100, 30.0059410]);
  const eastStops = snapOrderedStops(eastPath, EAST_REFERENCE_STOPS, 0.12);
  const westPath = selectTrack(osm, "west", [30.84144, 29.90808], [31.19967, 30.06046]);
  const westStops = snapOrderedStops(westPath, westStationReferences(osm, westPath), 0.12);
  const lrtPath = await googleLrtCapitalPath(apiKey);
  const lrtStops = snapOrderedStops(lrtPath, LRT_CAPITAL_STOPS, 0.20);
  const badr = nearestPathIndex(lrtPath, [31.715848, 30.175183]);
  if (badr.km > 0.20) throw new Error("Badr station is not on the Google LRT geometry");
  const knowledgeBranch = lrtKnowledgeBranchPath(osmLrt);
  const lrtKnowledgePath = [...lrtPath.slice(0, badr.index + 1), ...knowledgeBranch];
  const lrtKnowledgeStops = snapOrderedStops(lrtKnowledgePath, LRT_KNOWLEDGE_STOPS, 0.20);

  const updates: LineUpdate[] = [
    {
      lineNumber: "MR-E", name: "East Nile Monorail", from: "Cairo Stadium", to: "Justice City",
      points: eastPath, stops: eastStops, source: "osm_monorail_alignment_official_station_order",
      confidence: 0.98,
      evidence: { osmRelations: [13186211, 20384125], officialStationCount: 22,
        officialSources: ["https://www.nat.gov.eg/LocationActivity.aspx?id=2089", "https://sis.gov.eg/en/media-center/news/2nd-phase-of-east-nile-monorail-launched-saturday-expanding-link-to-new-capital/"],
        method: "single continuous OSM running track snapped to ordered official stations" },
    },
    {
      lineNumber: "MR-W", name: "West Nile Monorail", from: "New October", to: "Wadi El-Nile",
      points: westPath, stops: westStops, source: "osm_monorail_alignment_official_station_order",
      confidence: 0.97,
      evidence: { officialStationCount: 13,
        officialSource: "https://sis.gov.eg/en/media-center/news/transport-minister-inspects-progress-on-west-nile-monorail-project/",
        method: "single continuous OSM running track; station centers derived from 13 mapped station structures" },
    },
    {
      lineNumber: "LRT-1", name: "Cairo LRT — New Administrative Capital branch",
      from: "Adly Mansour", to: "Arts and Culture City", points: lrtPath, stops: lrtStops,
      source: "google_transit_licensed_study", confidence: 0.99,
      evidence: { googleLineName: "LRT Route", googleLineShortName: "LRT", routingMode: "transit_rail",
        licensedPermanentStudyStorage: true, licenseAcknowledgement: REQUIRED_LICENSE_ACK,
        officialSource: "https://www.cairo.gov.eg/ar/governorate-services/transportation-services/light-electric-train/",
        method: "only the named Google LRT transit-step polyline; walking and bus steps excluded" },
    },
    {
      lineNumber: "LRT-2", name: "Cairo LRT — Knowledge City branch",
      from: "Adly Mansour", to: "Knowledge City", points: lrtKnowledgePath, stops: lrtKnowledgeStops,
      source: "google_transit_trunk_osm_lrt_branch_licensed_study", confidence: 0.97,
      evidence: { googleTrunkLineName: "LRT Route", googleTrunkLineShortName: "LRT",
        licensedPermanentStudyStorage: true, licenseAcknowledgement: REQUIRED_LICENSE_ACK,
        branchSource: "Egypt OSM Cairo LRT rail ways and mapped LRT station nodes",
        officialSource: "https://www.cairo.gov.eg/ar/governorate-services/transportation-services/light-electric-train/",
        method: "Google LRT transit trunk through Badr joined at Badr station to continuous mapped LRT rail branch; no road routing" },
    },
  ];

  const report: any = { generatedAt: new Date().toISOString(), dryRun: process.argv.includes("--dry-run"), lines: [] };
  for (const update of updates) {
    const validation = {
      lineNumber: update.lineNumber,
      lengthKm: pathLengthKm(update.points),
      coordinateCount: update.points.length,
      stopCount: update.stops.length,
      endpoints: [update.points[0], update.points.at(-1)],
    };
    if (validation.lengthKm < 20 || validation.coordinateCount < 100) throw new Error(`${update.lineNumber} failed geometry validation`);
    if (process.argv.includes("--dry-run")) report.lines.push(validation);
    else report.lines.push({ ...validation, ...(await saveAcceptedLine(update)) });
  }
  if (!process.argv.includes("--dry-run")) {
    report.retiredSyntheticMonorailSegments = await retireFakeMonorailSegments();
  }
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.table(report.lines);
  console.log(`Audit written to ${REPORT_PATH}`);
}

main().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
}).finally(async () => {
  await pool.end().catch(() => undefined);
});
