const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'pk.eyJ1IjoibmV6YXJpc21haWwiLCJhIjoiY21ucTdoZ3gxMDRiNzJxcjRhemY0ejhhbyJ9.fkkcuisxpZP9y0Uaq9HryQ';

/**
 * Fetch a road-snapped path between two [lng, lat] coordinates from the
 * Mapbox Directions API. Falls back to a straight line on failure.
 */
export async function getDirections(
  from: [number, number],
  to: [number, number],
  profile: 'driving' | 'walking' = 'driving'
): Promise<[number, number][]> {
  try {
    const res = await fetch(
      `https://api.mapbox.com/directions/v5/mapbox/${profile}/${from[0]},${from[1]};${to[0]},${to[1]}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`
    );
    const data = await res.json();
    return data.routes?.[0]?.geometry?.coordinates || [from, to];
  } catch {
    return [from, to];
  }
}
