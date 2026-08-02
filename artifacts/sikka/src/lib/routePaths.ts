export type RoutingProfile = 'driving' | 'walking';
type LngLat = [number, number];

const toRad = (deg: number) => (deg * Math.PI) / 180;

const distanceKm = (a: LngLat, b: LngLat) => {
  const radiusKm = 6371;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const pathLengthKm = (coords: LngLat[]) => coords.reduce((sum, coord, index) => (
  index === 0 ? 0 : sum + distanceKm(coords[index - 1], coord)
), 0);

const pointToSegmentKm = (p: LngLat, a: LngLat, b: LngLat) => {
  const radiusKm = 6371;
  const cosLat = Math.cos(toRad(p[1]));
  const ax = toRad(a[0] - p[0]) * cosLat * radiusKm;
  const ay = toRad(a[1] - p[1]) * radiusKm;
  const bx = toRad(b[0] - p[0]) * cosLat * radiusKm;
  const by = toRad(b[1] - p[1]) * radiusKm;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (-ax * dx + -ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
};

const distanceToPathKm = (point: LngLat, path: LngLat[]) => {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i += 1) {
    best = Math.min(best, pointToSegmentKm(point, path[i], path[i + 1]));
  }
  return best;
};

const appendCoords = (target: LngLat[], coords: LngLat[]) => {
  coords.forEach((coord, index) => {
    if (index === 0 && target.length) return;
    target.push(coord);
  });
};

const compactPath = (coords: LngLat[]) => {
  const out: LngLat[] = [];
  coords.forEach((coord) => {
    const prev = out[out.length - 1];
    if (!prev || distanceKm(prev, coord) > 0.015) out.push(coord);
  });
  return out.length >= 2 ? out : coords;
};

const isStreetSnapSafe = (raw: LngLat[], snapped: LngLat[]) => {
  if (snapped.length < 2) return false;
  const rawLength = Math.max(0.05, pathLengthKm(raw));
  const snappedLength = pathLengthKm(snapped);
  if (snappedLength > rawLength * 1.8 + 0.6) return false;
  if (distanceKm(raw[0], snapped[0]) > 0.08) return false;
  if (distanceKm(raw[raw.length - 1], snapped[snapped.length - 1]) > 0.08) return false;

  const sampleCount = Math.min(40, snapped.length);
  for (let i = 0; i < sampleCount; i += 1) {
    const point = snapped[Math.round((i / Math.max(1, sampleCount - 1)) * (snapped.length - 1))];
    if (distanceToPathKm(point, raw) > 0.35) return false;
  }
  return true;
};

const interpolatePoint = (a: LngLat, b: LngLat, t: number): LngLat => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

const denseTraceForMatching = (coords: LngLat[]) => {
  const clean = compactPath(coords);
  if (clean.length < 2) return clean;
  const dense: LngLat[] = [clean[0]];
  const targetGapKm = 0.055;

  for (let i = 0; i < clean.length - 1; i += 1) {
    const a = clean[i];
    const b = clean[i + 1];
    const segmentKm = distanceKm(a, b);
    const steps = Math.max(1, Math.ceil(segmentKm / targetGapKm));
    for (let step = 1; step <= steps; step += 1) {
      dense.push(interpolatePoint(a, b, step / steps));
    }
  }

  return dense;
};

const matchOsrmTransitChunk = async (coords: LngLat[]): Promise<LngLat[] | null> => {
  if (coords.length < 2) return null;
  const encoded = coords.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const radiuses = coords.map(() => 90).join(';');
  const url = `https://router.project-osrm.org/match/v1/driving/${encoded}?overview=full&geometries=geojson&steps=false&annotations=false&gaps=ignore&tidy=true&radiuses=${radiuses}`;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const coords = data.matchings?.[0]?.geometry?.coordinates;
    return Array.isArray(coords) && coords.length >= 2 ? coords : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
};

const routeOsrmTransitChunk = async (coords: LngLat[]): Promise<LngLat[] | null> => {
  if (coords.length < 2) return null;
  const encoded = coords.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${encoded}?overview=full&geometries=geojson&steps=false`;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6500);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const coords = data.routes?.[0]?.geometry?.coordinates;
    return Array.isArray(coords) && coords.length >= 2 ? coords : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
};

const directionAnchorsForFixedRoute = (coords: LngLat[]) => {
  const dense = denseTraceForMatching(coords);
  const anchors: LngLat[] = [dense[0]];
  let sinceLast = 0;
  for (let i = 1; i < dense.length - 1; i += 1) {
    sinceLast += distanceKm(dense[i - 1], dense[i]);
    if (sinceLast >= 0.45) {
      anchors.push(dense[i]);
      sinceLast = 0;
    }
  }
  anchors.push(dense[dense.length - 1]);
  return anchors;
};

const matchTransitTraceToRoads = async (coords: LngLat[]) => {
  const trace = denseTraceForMatching(coords);
  if (trace.length < 2) return null;

  const osrmMatched: LngLat[] = [];
  for (let start = 0; start < trace.length - 1; start += 89) {
    const chunk = trace.slice(start, Math.min(trace.length, start + 90));
    const chunkMatch = await matchOsrmTransitChunk(chunk);
    if (!chunkMatch) {
      osrmMatched.length = 0;
      break;
    }
    appendCoords(osrmMatched, chunkMatch);
  }
  if (osrmMatched.length >= 2) return osrmMatched;

  const anchors = directionAnchorsForFixedRoute(coords);
  const osrmRouted: LngLat[] = [];
  for (let start = 0; start < anchors.length - 1; start += 23) {
    const chunk = anchors.slice(start, Math.min(anchors.length, start + 24));
    const chunkRoute = await routeOsrmTransitChunk(chunk);
    if (!chunkRoute) {
      osrmRouted.length = 0;
      break;
    }
    appendCoords(osrmRouted, chunkRoute);
  }
  if (osrmRouted.length >= 2) return osrmRouted;

  const matched: LngLat[] = [];
  const chunkSize = 90;
  for (let start = 0; start < trace.length - 1; start += chunkSize - 1) {
    const chunk = trace.slice(start, Math.min(trace.length, start + chunkSize));
    const chunkMatch = await matchOsrmTransitChunk(chunk);
    if (!chunkMatch) return null;
    appendCoords(matched, chunkMatch);
  }
  return matched.length >= 2 ? matched : null;
};

/**
 * Fetch a road-snapped path between two [lng, lat] coordinates using open
 * OpenStreetMap/OSRM routing. Falls back to a straight line on failure.
 */
export async function getDirections(
  from: LngLat,
  to: LngLat,
  profile: RoutingProfile = 'driving'
): Promise<LngLat[]> {
  const drivingUrls = [
    `https://router.project-osrm.org/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=false`,
    `https://routing.openstreetmap.de/routed-car/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=false`,
  ];
  const walkingUrls = [
    `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=false`,
    `https://router.project-osrm.org/route/v1/foot/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=false`,
    `https://router.project-osrm.org/route/v1/walking/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=false`,
  ];

  for (const url of profile === 'walking' ? walkingUrls : drivingUrls) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4500);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) continue;
      const data = await res.json();
      const coords = data.routes?.[0]?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length >= 2) return coords;
    } catch {
      // Try the next public routing endpoint before falling back.
    } finally {
      window.clearTimeout(timeout);
    }
  }

  return [from, to];
}

export async function snapTransitPathToRoads(coords: LngLat[]): Promise<LngLat[]> {
  const raw = compactPath(coords);
  if (raw.length < 2) return raw;

  const matched = await matchTransitTraceToRoads(raw);
  if (matched && isStreetSnapSafe(raw, matched)) {
    matched[0] = raw[0];
    matched[matched.length - 1] = raw[raw.length - 1];
    return matched;
  }

  return raw;
}
