export type RoutingProfile = 'driving' | 'walking';
type LngLat = [number, number];

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

const toRad = (deg: number) => deg * Math.PI / 180;

const distanceKm = (a: LngLat, b: LngLat) => {
  const radiusKm = 6371;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const appendCoords = (target: LngLat[], coords: LngLat[]) => {
  coords.forEach((coord, index) => {
    if (index === 0 && target.length) return;
    target.push(coord);
  });
};

const downsampleByIndex = (coords: LngLat[], maxPoints: number) => {
  if (coords.length <= maxPoints) return coords;
  const sampled: LngLat[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const idx = Math.round((i / (maxPoints - 1)) * (coords.length - 1));
    sampled.push(coords[idx]);
  }
  return sampled;
};

const samplePath = (coords: LngLat[], spacingKm: number, maxPoints: number) => {
  if (coords.length <= 2) return coords;
  const sampled: LngLat[] = [coords[0]];
  let sinceLastKm = 0;
  for (let i = 1; i < coords.length - 1; i += 1) {
    sinceLastKm += distanceKm(coords[i - 1], coords[i]);
    if (sinceLastKm >= spacingKm) {
      sampled.push(coords[i]);
      sinceLastKm = 0;
    }
  }
  sampled.push(coords[coords.length - 1]);
  return downsampleByIndex(sampled, maxPoints);
};

const matchChunk = async (coords: LngLat[]): Promise<LngLat[] | null> => {
  if (coords.length < 2) return null;
  const encoded = coords.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const radiuses = coords.map(() => 80).join(';');
  const url = `https://router.project-osrm.org/match/v1/driving/${encoded}?overview=full&geometries=geojson&steps=false&annotations=false&gaps=ignore&tidy=true&radiuses=${radiuses}`;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5500);
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

const matchPathToRoads = async (coords: LngLat[]) => {
  const matched: LngLat[] = [];
  const chunkSize = 80;
  for (let start = 0; start < coords.length - 1; start += chunkSize - 1) {
    const chunk = coords.slice(start, Math.min(coords.length, start + chunkSize));
    const chunkMatch = await matchChunk(chunk);
    if (!chunkMatch) return null;
    appendCoords(matched, chunkMatch);
  }
  return matched.length >= 2 ? matched : null;
};

const routeThroughAnchors = async (coords: LngLat[], profile: RoutingProfile) => {
  const anchors = downsampleByIndex(coords, profile === 'walking' ? 14 : 18);
  const routed: LngLat[] = [];
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const leg = await getDirections(anchors[i], anchors[i + 1], profile);
    appendCoords(routed, leg);
  }
  return routed.length >= 2 ? routed : coords;
};

export async function snapPathToRoads(
  coords: LngLat[],
  profile: RoutingProfile = 'driving'
): Promise<LngLat[]> {
  if (coords.length < 2) return coords;
  if (coords.length === 2) return getDirections(coords[0], coords[1], profile);

  const sampled = samplePath(coords, profile === 'walking' ? 0.12 : 0.18, 90);
  if (profile === 'driving') {
    const matched = await matchPathToRoads(sampled);
    if (matched?.length) return matched;
  }

  return routeThroughAnchors(sampled, profile);
}
