/**
 * Bus route data enrichment pipeline.
 *
 * Cairo's road network has many narrow side-streets that a naive router will
 * happily cut through. This pipeline injects "common sense" before snapping:
 *
 *   1. AI "breadcrumb" pre-processor — an LLM acting as a Cairo Transit
 *      Engineer expands vague stops (["Roxy","Abbassia"]) into precise hubs +
 *      intermediate main-road breadcrumbs (["Roxy Square","Khalifa El-Maamon
 *      Street","Abbassia Square Bus Hub"]) so the route is pinned to primary
 *      corridors.
 *   2. Geocode each breadcrumb to a coordinate via Nominatim (free, no key).
 *   3. Drop any breadcrumb whose geocoded position would force the route to
 *      travel backwards — this is what used to let a single bad geocode send
 *      the whole route looping back on itself.
 *   4. Snap via OSRM Map Matching (free, no key) with a generous per-point
 *      radius, falling back to plain OSRM routing.
 *   5. Run a final geometry sanity check; if the assembled path is still far
 *      longer than the straight-line distance between its endpoints, the
 *      result is flagged so the caller can route it to admin review instead
 *      of shipping it to riders.
 *   6. Caller saves the resulting LineString to transit_lines.route_path.
 */
import { getAIClient, getAIModel } from "./aiClient";
import {
  geocodeStopNominatim,
  haversineKm,
  dropBacktrackingPoints,
  snapToRoadsFree,
  checkPathQuality,
} from "./routePathGenerator";

// ─── 1. AI breadcrumb pre-processor ─────────────────────────────────────────

const breadcrumbCache = new Map<string, string[]>();

const SYSTEM_PROMPT =
  `You are a veteran Cairo public-transit engineer who has driven and surveyed ` +
  `the city's bus, microbus and serfis network for 20 years. You know exactly ` +
  `which major squares, bridges and primary thoroughfares (main roads) real ` +
  `buses use, and which narrow residential side-streets they NEVER enter.\n\n` +
  `Given an ORDERED list of vague bus-stop area names for a single route, ` +
  `rewrite it into a DENSE, ordered list of PRECISE, geocodable waypoints that ` +
  `pin the route tightly to major corridors so a road router has no room to ` +
  `divert onto side streets. Rules:\n` +
  `- Keep the same overall direction and order (first stop stays first, last ` +
  `stays last).\n` +
  `- Convert each vague area into a specific, well-known landmark or hub ` +
  `(e.g. "Roxy" -> "Roxy Square, Heliopolis"; "Abbassia" -> "Abbassia Square").\n` +
  `- BETWEEN consecutive stops, name the SPECIFIC street corridor the bus rides ` +
  `along, adding a breadcrumb waypoint roughly every ~300 m so consecutive ` +
  `waypoints are close together. Reference Cairo's real major arteries, squares ` +
  `and bridges by their well-known names (e.g. "Corniche El Nil", "Salah Salem ` +
  `Road", "Ramsis Street", "Abbas El-Akkad Street", "Shubra Street", "Port Said ` +
  `Street", "Cleopatra Street", "Khalifa El-Maamon Street", "6th October ` +
  `Bridge", "Tahrir Square", "Roxy Square").\n` +
  `- REJECT any waypoint that is not on a named major street, primary ` +
  `thoroughfare, well-known square or bridge. Never invent tiny residential ` +
  `streets, alleys or unnamed lanes.\n` +
  `- Every waypoint must be a real, searchable place in the given city so a ` +
  `geocoder can resolve it. Prefer "Street name, District" form for precision.\n` +
  `- Use as many breadcrumbs as the corridor needs for ~300 m spacing, but do ` +
  `NOT exceed 60 total waypoints.\n` +
  `- Never describe a route that backtracks or revisits an earlier area — the ` +
  `path must move steadily from the first stop toward the last.\n` +
  `Respond ONLY with strict JSON: {"waypoints": ["...", "..."]}.`;

export async function expandStopsWithAI(
  stops: string[],
  city = "Cairo",
): Promise<string[]> {
  const clean = stops.map(s => s?.trim()).filter(Boolean) as string[];
  if (clean.length < 2) return clean;

  const cacheKey = `${city}|${clean.join(">")}`;
  const cached = breadcrumbCache.get(cacheKey);
  if (cached) return cached;

  const client = getAIClient();
  if (!client) return clean; // no key → degrade to raw stops

  try {
    const completion = await client.chat.completions.create({
      model: getAIModel(),
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `City: ${city}, Egypt\n` +
            `Bus route stops (in order):\n` +
            clean.map((s, i) => `${i + 1}. ${s}`).join("\n"),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return clean;

    const parsed = JSON.parse(raw) as { waypoints?: unknown };
    let wp = Array.isArray(parsed.waypoints)
      ? parsed.waypoints.map(x => String(x).trim()).filter(Boolean)
      : [];
    if (wp.length < 2) return clean;
    // Hard cap: keep the model honest about the 60-waypoint ceiling even if it
    // over-produces. Trim from the CENTER so both terminals AND the breadcrumb
    // density near each endpoint survive — dropping the whole tail would create a
    // long unconstrained jump near the end and reintroduce side-street drift.
    const CAP = 60;
    if (wp.length > CAP) {
      const keepHead = Math.ceil(CAP / 2);   // 30
      const keepTail = CAP - keepHead;       // 30
      wp = [...wp.slice(0, keepHead), ...wp.slice(wp.length - keepTail)];
    }

    // Hard guard: the AI must never drop the route's true terminals. Re-anchor
    // the original first/last stop so the polyline always starts/ends at the
    // real endpoints (coordinate dedup later collapses any near-duplicate hub).
    if (wp[0] !== clean[0]) wp.unshift(clean[0]);
    if (wp[wp.length - 1] !== clean[clean.length - 1]) wp.push(clean[clean.length - 1]);

    breadcrumbCache.set(cacheKey, wp);
    return wp;
  } catch (err) {
    console.error("AI breadcrumb expansion failed:", err instanceof Error ? err.message : err);
    return clean;
  }
}

// ─── Full pipeline ──────────────────────────────────────────────────────────

export interface EnrichResult {
  routePath: { type: "LineString"; coordinates: [number, number][] } | null;
  expandedCount: number;
  geocodedCount: number;
  droppedBacktrackCount: number;
  usedAI: boolean;
  /** True when the assembled path still failed the post-hoc sanity check —
   *  the caller should mark the route needs_review instead of shipping it. */
  flagged: boolean;
  flagReason: string | null;
}

/**
 * area names -> AI breadcrumbs -> geocoded points -> backtrack-filtered ->
 * map-matched LineString. Free end-to-end (Nominatim + OSRM); the AI step is
 * the only part that costs anything, and degrades gracefully without a key.
 */
export async function buildBusRoutePathAI(
  fromArea: string,
  toArea: string,
  viaStops: string[],
  city = "Cairo",
): Promise<EnrichResult> {
  const empty: EnrichResult = {
    routePath: null, expandedCount: 0, geocodedCount: 0,
    droppedBacktrackCount: 0, usedAI: false, flagged: false, flagReason: null,
  };

  const rawStops = [fromArea, ...(viaStops || []), toArea].filter(Boolean);
  if (rawStops.length < 2) return empty;

  // 1. AI breadcrumb expansion
  const expanded = await expandStopsWithAI(rawStops, city);
  const usedAI = expanded.length !== rawStops.length
    || expanded.some((s, i) => s !== rawStops[i]);

  // 2. Geocode each waypoint via Nominatim (gentle rate limit is handled inside
  //    geocodeStopNominatim). Drop consecutive name dups and near-coincident
  //    coordinates so re-anchored endpoints don't zigzag.
  const points: [number, number][] = [];
  let last = "";
  for (const stop of expanded) {
    if (stop === last) continue;
    last = stop;
    const pt = await geocodeStopNominatim(stop, city);
    if (pt) {
      const prev = points[points.length - 1];
      if (!prev || haversineKm(prev, pt) > 0.12) points.push(pt);
    }
  }

  if (points.length < 2) {
    return { ...empty, expandedCount: expanded.length, usedAI };
  }

  // 3. Drop any point that would force the route to travel backwards — this
  //    is the fix for the single-bad-geocode "loops around itself" bug.
  const filtered = dropBacktrackingPoints(points);
  const droppedBacktrackCount = points.length - filtered.length;

  // 4. Snap to roads (Map Matching first, OSRM Directions fallback).
  const snapped = await snapToRoadsFree(filtered, "car");
  if (snapped.length < 2) {
    return { ...empty, expandedCount: expanded.length, geocodedCount: points.length, usedAI, droppedBacktrackCount };
  }

  // 5. Final sanity check on the assembled geometry.
  const quality = checkPathQuality(snapped);

  return {
    routePath: { type: "LineString", coordinates: snapped },
    expandedCount: expanded.length,
    geocodedCount: points.length,
    droppedBacktrackCount,
    usedAI,
    flagged: !quality.ok,
    flagReason: quality.reason,
  };
}
