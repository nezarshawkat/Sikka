/**
 * Server-side route path generation utilities.
 *
 * Geocoding and road-snapping here are built on free, key-less services
 * (Nominatim + OSRM) so this pipeline never requires a billed API account.
 * The primary path depends only on these free services.
 */

function validLngLat(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lng) && Number.isFinite(lat) &&
    lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90
  );
}

// ─── Geometry sanity helpers ────────────────────────────────────────────────

/** Great-circle distance in km between two [lng, lat] points. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function totalPathKm(points: [number, number][]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += haversineKm(points[i - 1], points[i]);
  return sum;
}

/**
 * Drops any point that would require the route to travel backwards relative
 * to its overall direction of travel. Each point is scored by its scalar
 * projection onto the straight line from the route's first to last point; a
 * real corridor is allowed some wiggle (it doesn't have to be a straight
 * line), so a point is only rejected when its projection falls meaningfully
 * *behind* the previous accepted point — which is the exact signature of a
 * single mis-geocoded waypoint that yanks the snapped path back on itself.
 *
 * This is the fix for routes that "loop around themselves": the bad point is
 * removed before it ever reaches the road-snapping step, instead of being
 * dutifully routed to (producing a real, but wrong, backtrack).
 */
export function dropBacktrackingPoints(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points;

  const first = points[0];
  const last = points[points.length - 1];
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const spanSq = dx * dx + dy * dy;
  if (spanSq === 0) return points; // start === end; nothing to project against

  const projection = (p: [number, number]) =>
    ((p[0] - first[0]) * dx + (p[1] - first[1]) * dy) / spanSq;

  // Allow ~18% backward slack relative to the route's total span so genuine
  // S-curves, loops around a square, or one-way detours survive — only an
  // egregious backtrack (almost always a geocoding error) gets dropped.
  const SLACK = 0.18;

  const kept: [number, number][] = [points[0]];
  let lastProgress = projection(points[0]);
  for (let i = 1; i < points.length; i++) {
    const p = projection(points[i]);
    if (p < lastProgress - SLACK && i < points.length - 1) continue; // drop, but never drop the true endpoint
    kept.push(points[i]);
    lastProgress = Math.max(lastProgress, p);
  }
  return kept.length >= 2 ? kept : points;
}

export interface PathQuality {
  ok: boolean;
  reason: string | null;
  lengthRatio: number;
}

/**
 * Post-hoc check on the FINAL assembled geometry: a sane urban transit route
 * shouldn't be wildly longer than the straight-line distance between its
 * endpoints. A high ratio is the fingerprint of a route that still loops or
 * zigzags despite the earlier filtering — flag it for admin review instead of
 * shipping it to riders silently.
 */
export function checkPathQuality(points: [number, number][]): PathQuality {
  if (points.length < 2) return { ok: false, reason: "fewer than 2 points", lengthRatio: 0 };
  const straight = haversineKm(points[0], points[points.length - 1]);
  const actual = totalPathKm(points);
  if (straight < 0.05) return { ok: true, reason: null, lengthRatio: 1 }; // loop route back to start; ratio meaningless
  const ratio = actual / straight;
  if (ratio > 3.5) {
    return { ok: false, reason: `path is ${ratio.toFixed(1)}x the straight-line distance (likely a loop/backtrack)`, lengthRatio: ratio };
  }
  return { ok: true, reason: null, lengthRatio: ratio };
}

/** Best-effort extraction of an EN/AR name pair from a Nominatim result's
 *  `namedetails` block (present when `namedetails=1` is requested), falling
 *  back sensibly when one language isn't tagged on that OSM feature. */
function extractBilingualName(
  namedetails: Record<string, string> | undefined,
  displayName: string | undefined,
  requestedLanguageName: string | undefined,
): { nameEn: string | null; nameAr: string | null } {
  const base = namedetails?.name ?? requestedLanguageName ?? displayName?.split(",")[0]?.trim() ?? null;
  const en = namedetails?.["name:en"] ?? (base && !/[\u0600-\u06FF]/.test(base) ? base : null);
  const ar = namedetails?.["name:ar"] ?? (base && /[\u0600-\u06FF]/.test(base) ? base : null);
  return { nameEn: en, nameAr: ar };
}

/** Reverse-geocodes a point to a bilingual place name -- used to auto-fill
 *  the boarding-point ("get in") area from where a rider's GPS trace
 *  actually started, instead of asking them to type it. */
export async function reverseGeocodeBilingual(
  lng: number,
  lat: number,
): Promise<{ nameEn: string | null; nameAr: string | null } | null> {
  if (!validLngLat(lng, lat)) return null;
  // Route legs share endpoints (a transfer is one leg's get-off and the next
  // leg's get-in). Cache the exact coordinate lookup so naming instructions
  // does not repeat external work for that shared, drawn point.
  const cacheKey = `reverse|${lng.toFixed(6)}|${lat.toFixed(6)}`;
  const cached = reverseGeocodeCache.get(cacheKey);
  if (cached) return cached;
  const lookup = (async () => {
    await respectNominatimRateLimit();
    const url = `${NOMINATIM_BASE}/reverse?format=jsonv2&namedetails=1&zoom=17&lat=${lat}&lon=${lng}`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "ar,en" },
      });
      if (!res.ok) return null;
      const data = await res.json() as { display_name?: string; namedetails?: Record<string, string>; name?: string };
      const result = extractBilingualName(data.namedetails, data.display_name, data.name);
      return result.nameEn || result.nameAr ? result : null;
    } catch {
      return null;
    }
  })();
  reverseGeocodeCache.set(cacheKey, lookup);
  return lookup;
}

/** Forward-searches free text (whatever language a contributor typed) and
 *  returns both an English and Arabic name for the same real place, so a
 *  route only ever needs one language typed in and still ends up with both
 *  stored -- never done by hand, never left half-translated. */
export async function searchBilingualPlace(
  query: string,
  city = "Cairo",
): Promise<{ nameEn: string | null; nameAr: string | null } | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  await respectNominatimRateLimit();
  const url =
    `${NOMINATIM_BASE}/search?format=jsonv2&limit=1&countrycodes=eg&namedetails=1`
    + `&bounded=0&viewbox=${EGYPT_VIEWBOX}&q=${encodeURIComponent(`${trimmed}, ${city}, Egypt`)}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "ar,en" },
    });
    if (!res.ok) return null;
    const data = await res.json() as Array<{ display_name?: string; namedetails?: Record<string, string>; name?: string }>;
    if (!data?.length) return null;
    const result = extractBilingualName(data[0].namedetails, data[0].display_name, data[0].name);
    if (!result.nameEn && !result.nameAr) return null;
    return result;
  } catch {
    return null;
  }
}

// ─── Nominatim geocoding (free, no key, no billing) ─────────────────────────

const NOMINATIM_BASE = (process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/+$/, "");
// Nominatim's public-instance usage policy caps requests at ~1/second and asks
// for an identifying User-Agent. Self-host Nominatim for production volume —
// this delay just keeps the free public instance usable and ToS-compliant for
// admin-triggered batch enrichment jobs.
const NOMINATIM_DELAY_MS = 1100;
const USER_AGENT = "Sikka-Cairo-Transit-App/1.0 (route enrichment)";

const geocodeCache = new Map<string, [number, number]>();
const reverseGeocodeCache = new Map<string, Promise<{ nameEn: string | null; nameAr: string | null } | null>>();
let lastNominatimCallAt = 0;
let nominatimSlot: Promise<void> = Promise.resolve();

async function respectNominatimRateLimit(): Promise<void> {
  // Calls can be requested concurrently while a trip's legs are being
  // finalized. Reserve a slot first so they cannot all observe the same old
  // timestamp and burst past Nominatim's one-request-per-second policy.
  let releaseSlot!: () => void;
  const previousSlot = nominatimSlot;
  nominatimSlot = new Promise<void>((resolve) => { releaseSlot = resolve; });
  await previousSlot;
  const elapsed = Date.now() - lastNominatimCallAt;
  if (elapsed < NOMINATIM_DELAY_MS) await new Promise((r) => setTimeout(r, NOMINATIM_DELAY_MS - elapsed));
  lastNominatimCallAt = Date.now();
  releaseSlot();
}

const EGYPT_VIEWBOX = "24.7,31.9,36.9,21.6"; // lon1,lat1,lon2,lat2 bounding the whole country

/** Geocode a free-text place/stop name via Nominatim. Free, no API key. */
export async function geocodeStopNominatim(
  stop: string,
  city = "Cairo",
): Promise<[number, number] | null> {
  const cacheKey = `nom|${stop}|${city}`;
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey)!;

  await respectNominatimRateLimit();
  const query = `${stop}, ${city}, Egypt`;
  const url =
    `${NOMINATIM_BASE}/search?format=jsonv2&limit=1&countrycodes=eg`
    + `&bounded=0&viewbox=${EGYPT_VIEWBOX}&q=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return null;
    const data = await res.json() as Array<{ lat: string; lon: string }>;
    if (!data?.length) return null;
    const lng = Number(data[0].lon);
    const lat = Number(data[0].lat);
    if (!validLngLat(lng, lat)) return null;
    const center: [number, number] = [lng, lat];
    geocodeCache.set(cacheKey, center);
    return center;
  } catch {
    return null;
  }
}

// ─── OSRM road snapping & map matching (free, no key, no billing) ──────────

const OSRM_DRIVING_BASE = (process.env.OSRM_DRIVING_URL || "https://routing.openstreetmap.de/routed-car").replace(/\/+$/, "");
const OSRM_FOOT_BASE = (process.env.OSRM_FOOT_URL || "https://routing.openstreetmap.de/routed-foot").replace(/\/+$/, "");
// Keep a second public OSRM instance available for map matching. The primary
// instance is occasionally rate limited, and a routing outage must not make
// a valid discovery unusable. A configured server remains the first choice.
const OSRM_DRIVING_BASES = [...new Set([
  OSRM_DRIVING_BASE,
  "https://router.project-osrm.org",
])];
const GOOGLE_ROADS_URL = "https://roads.googleapis.com/v1/snapToRoads";

/**
 * Google Roads is an opt-in production fallback for road matching. Unlike
 * public OSRM demos, it has an authenticated service contract. Keep this
 * behind a server-only key: the Android Maps key is intentionally unsuitable
 * because it is restricted to the mobile app.
 */
async function matchWithGoogleRoads(points: [number, number][]): Promise<[number, number][] | null> {
  const apiKey = process.env.GOOGLE_ROADS_API_KEY?.trim();
  if (!apiKey || points.length < 2) return null;

  const allCoords: [number, number][] = [];
  const CHUNK = 100; // Snap to Roads accepts at most 100 original points.
  for (let i = 0; i < points.length - 1; i += CHUNK - 1) {
    const chunk = points.slice(i, Math.min(i + CHUNK, points.length));
    if (chunk.length < 2) continue;
    const url = new URL(GOOGLE_ROADS_URL);
    url.searchParams.set("path", chunk.map(([lng, lat]) => `${lat},${lng}`).join("|"));
    url.searchParams.set("interpolate", "true");
    url.searchParams.set("key", apiKey);
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { "User-Agent": USER_AGENT },
      });
      if (!response.ok) return null;
      const data = await response.json() as {
        snappedPoints?: Array<{ location?: { latitude?: number; longitude?: number } }>;
      };
      const coords = (data.snappedPoints ?? [])
        .map((point): [number, number] | null => {
          const lat = point.location?.latitude;
          const lng = point.location?.longitude;
          return typeof lng === "number" && typeof lat === "number" ? [lng, lat] : null;
        })
        .filter((point): point is [number, number] => point != null);
      if (coords.length < 2) return null;
      if (allCoords.length === 0) allCoords.push(...coords);
      else allCoords.push(...coords.slice(1));
    } catch {
      return null;
    }
  }
  return allCoords.length >= 2 ? allCoords : null;
}

/**
 * OSRM Map Matching: given a rough, possibly-noisy ordered sequence of
 * points, find the most plausible path a road-bound vehicle actually took.
 * This is the right tool for "I have hint points, not a perfect trace" —
 * unlike Directions (which just routes optimally between waypoints one pair
 * at a time), Map Matching reasons about the whole sequence jointly via a
 * hidden-Markov model, so it tolerates a noisy point without producing a
 * wild detour to reach it.
 */
export async function matchToRoads(
  points: [number, number][],
  profile: "car" | "foot" = "car",
): Promise<[number, number][] | null> {
  if (points.length < 2) return null;
  const bases = profile === "foot" ? [OSRM_FOOT_BASE] : OSRM_DRIVING_BASES;
  // OSRM's standard car profile is named "driving". Using "car" works on
  // some self-hosted deployments, but the public instances reject it.
  const osrmProfile = profile === "foot" ? "foot" : "driving";

  // OSRM match has a practical waypoint ceiling per request; chunk generously.
  const CHUNK = 80;
  const allCoords: [number, number][] = [];

  for (const base of bases) {
    allCoords.length = 0;
    let failed = false;
    for (let i = 0; i < points.length - 1; i += CHUNK - 1) {
      const chunk = points.slice(i, Math.min(i + CHUNK, points.length));
      if (chunk.length < 2) continue;
      const coordStr = chunk.map((p) => `${p[0]},${p[1]}`).join(";");
      // Generous 80 m radius per point: tolerant of a noisy geocode without
      // letting the match wander arbitrarily far off the intended corridor.
      const radii = chunk.map(() => 80).join(";");
      // `gaps=ignore` preserves the usable parts of a real GPS recording
      // instead of rejecting the entire trip for one weak location fix.
      const url = `${base}/match/v1/${osrmProfile}/${coordStr}?geometries=geojson&overview=full&radiuses=${radii}&gaps=ignore&tidy=true`;

      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(15_000),
          headers: { "User-Agent": USER_AGENT },
        });
        if (!res.ok) { failed = true; break; }
        const data = await res.json() as {
          code?: string;
          matchings?: Array<{ geometry: { coordinates: [number, number][] }; confidence?: number }>;
        };
        if (data.code !== "Ok" || !data.matchings?.length) { failed = true; break; }
        // OSRM may return several ordered matchings when GPS briefly loses
        // the road. Keeping every segment is crucial: choosing only the
        // highest-confidence segment previously made a whole trip appear too
        // short and caused discovery to report a misleading service failure.
        const matchedCoords = data.matchings.flatMap((matching) => matching.geometry?.coordinates ?? []);
        if (matchedCoords.length < 2) { failed = true; break; }
        if (allCoords.length === 0) allCoords.push(...matchedCoords);
        else allCoords.push(...matchedCoords.slice(1));
      } catch {
        failed = true;
        break;
      }
    }
    if (!failed && allCoords.length >= 2) return allCoords;
  }
  // A directions request is less precise than map matching, but it still
  // produces a road-bound geometry and is a better fallback than discarding
  // a valid discovery when OSRM cannot match one noisy GPS sample.
  const routed = await routeViaOsrm(points, profile);
  if (routed) return routed;
  return profile === "car" ? matchWithGoogleRoads(points) : null;
}

/** OSRM Directions fallback for when Map Matching can't find a confident match. */
export async function routeViaOsrm(
  points: [number, number][],
  profile: "car" | "foot" = "car",
): Promise<[number, number][] | null> {
  if (points.length < 2) return null;
  const bases = profile === "foot" ? [OSRM_FOOT_BASE] : OSRM_DRIVING_BASES;
  const osrmProfile = profile === "foot" ? "foot" : "driving";
  // Routing services limit waypoints too. Keep the overlap so the joined
  // route remains continuous for long trip-discovery recordings.
  const CHUNK = 80;
  for (const base of bases) {
    const allCoords: [number, number][] = [];
    let failed = false;
    for (let i = 0; i < points.length - 1; i += CHUNK - 1) {
      const chunk = points.slice(i, Math.min(i + CHUNK, points.length));
      if (chunk.length < 2) continue;
      const coordStr = chunk.map((p) => `${p[0]},${p[1]}`).join(";");
      const url = `${base}/route/v1/${osrmProfile}/${coordStr}?overview=full&geometries=geojson&steps=false`;
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(15_000),
          headers: { "User-Agent": USER_AGENT },
        });
        if (!res.ok) { failed = true; break; }
        const data = await res.json() as { code?: string; routes?: Array<{ geometry: { coordinates: [number, number][] } }> };
        const coords = data.code === "Ok" ? data.routes?.[0]?.geometry?.coordinates : null;
        if (!coords || coords.length < 2) { failed = true; break; }
        if (allCoords.length === 0) allCoords.push(...coords);
        else allCoords.push(...coords.slice(1));
      } catch {
        failed = true;
        break;
      }
    }
    if (!failed && allCoords.length >= 2) return allCoords;
  }
  return null;
}

export interface WalkingStep {
  /** Plain-language instruction, e.g. "Turn right onto Talaat Harb Street". */
  instruction: string;
  distanceMeters: number;
  /** Maneuver location, for placing a marker if the UI wants one. */
  location: [number, number];
}

export interface WalkingDirections {
  geometry: [number, number][];
  steps: WalkingStep[];
  distanceMeters: number;
  durationSeconds: number;
}

const MANEUVER_VERBS: Record<string, string> = {
  turn: "Turn", "new name": "Continue onto", depart: "Head out on",
  arrive: "Arrive at", merge: "Merge onto", "on ramp": "Take the ramp onto",
  "off ramp": "Take the exit onto", fork: "At the fork, take",
  "end of road": "At the end of the road, turn", continue: "Continue onto",
  roundabout: "At the roundabout, take the exit onto", rotary: "At the roundabout, take the exit onto",
  "roundabout turn": "At the roundabout, turn", notification: "Continue",
};

function describeManeuver(maneuver: { type?: string; modifier?: string }, streetName: string): string {
  const type = maneuver.type || "continue";
  const modifier = maneuver.modifier ? ` ${maneuver.modifier}` : "";
  const verb = MANEUVER_VERBS[type] || "Continue";
  const onto = streetName ? ` onto ${streetName}` : "";
  if (type === "depart") return `Head out${streetName ? ` on ${streetName}` : ""}`;
  if (type === "arrive") return "You've arrived at your stop";
  if (type === "turn" || type === "end of road" || type === "roundabout turn") {
    return `${verb}${modifier}${onto}`;
  }
  return `${verb}${onto}`;
}

/**
 * Real turn-by-turn walking directions via OSRM (free, no key) — used for the
 * first/last-mile walking legs so riders get actual street-level guidance
 * instead of just a line on the map.
 */
export async function getWalkingDirections(
  a: [number, number],
  b: [number, number],
): Promise<WalkingDirections | null> {
  const coordStr = `${a[0]},${a[1]};${b[0]},${b[1]}`;
  const url = `${OSRM_FOOT_BASE}/route/v1/foot/${coordStr}?overview=full&geometries=geojson&steps=true`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = await res.json() as {
      code?: string;
      routes?: Array<{
        distance: number; duration: number;
        geometry: { coordinates: [number, number][] };
        legs: Array<{ steps: Array<{
          distance: number; name: string;
          maneuver: { type: string; modifier?: string; location: [number, number] };
        }> }>;
      }>;
    };
    if (data.code !== "Ok" || !data.routes?.length) return null;
    const route = data.routes[0];
    const steps: WalkingStep[] = (route.legs ?? []).flatMap((leg) =>
      leg.steps
        .filter((s) => s.maneuver.type !== "notification")
        .map((s) => ({
          instruction: describeManeuver(s.maneuver, s.name),
          distanceMeters: Math.round(s.distance),
          location: s.maneuver.location,
        })),
    );
    return {
      geometry: route.geometry.coordinates,
      steps,
      distanceMeters: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
    };
  } catch {
    return null;
  }
}

/**
 * Full free-stack snap: try map matching first (best fit for noisy hint
 * points), fall back to plain directions, and fall back to the raw points
 * if both routing services are unreachable so a route is never dropped
 * entirely just because a routing call timed out.
 */
export async function snapToRoadsFree(
  points: [number, number][],
  profile: "car" | "foot" = "car",
): Promise<[number, number][]> {
  const cleaned = dropBacktrackingPoints(points);
  const matched = await matchToRoads(cleaned, profile);
  if (matched) return matched;
  const routed = await routeViaOsrm(cleaned, profile);
  if (routed) return routed;
  return cleaned;
}

export async function geocodeStop(
  stop: string,
  city = "Cairo",
  country = "Egypt",
): Promise<[number, number] | null> {
  const free = await geocodeStopNominatim(stop, city);
  if (free) return free;

  return null;
}

export async function snapFootOsrm(
  a: [number, number],
  b: [number, number],
): Promise<[number, number][] | null> {
  return routeViaOsrm([a, b], "foot");
}

export async function snapConnector(
  profile: "walking" | "driving",
  a: [number, number],
  b: [number, number],
): Promise<[number, number][] | null> {
  const osrmProfile = profile === "walking" ? "foot" : "car";
  return routeViaOsrm([a, b], osrmProfile);
}

export async function snapToRoads(points: [number, number][]): Promise<[number, number][]> {
  return snapToRoadsFree(points, "car");
}

/** Full pipeline: area names -> geocoded points -> road-snapped LineString. */
export async function buildRoutePath(
  fromArea: string,
  toArea: string,
  viaStops: string[],
  city = "Cairo",
): Promise<{ type: string; coordinates: [number, number][] } | null> {
  const stops = [fromArea, ...viaStops, toArea].filter(Boolean);
  const sampled = stops.length <= 12
    ? stops
    : [
        stops[0],
        ...stops.slice(1, -1).filter((_, i) => i % Math.ceil((stops.length - 2) / 10) === 0),
        stops[stops.length - 1],
      ].slice(0, 12);

  const points: [number, number][] = [];
  for (const stop of sampled) {
    const pt = await geocodeStopNominatim(stop, city);
    if (pt) points.push(pt);
  }

  if (points.length < 2) return null;
  const snapped = await snapToRoadsFree(points, "car");
  return snapped.length >= 2 ? { type: "LineString", coordinates: snapped } : null;
}
