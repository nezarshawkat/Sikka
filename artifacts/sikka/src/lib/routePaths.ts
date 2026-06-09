export type RoutingProfile = 'driving' | 'walking';

/**
 * Fetch a road-snapped path between two [lng, lat] coordinates using open
 * OpenStreetMap/OSRM routing. Falls back to a straight line on failure.
 */
export async function getDirections(
  from: [number, number],
  to: [number, number],
  profile: RoutingProfile = 'driving'
): Promise<[number, number][]> {
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
