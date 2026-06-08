import type { Coord } from "./types.js";

export function haversineKm(a: Coord, b: Coord): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// Normalize a stop / area name into a stable key so the same physical place
// referenced by different lines collapses onto one graph node.
export function normalizeName(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "") // strip Arabic diacritics
    .replace(/[().,/\\\-_"'`]+/g, " ")
    .replace(/\b(station|محطة|مترو|metro|terminal|موقف)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// route_path coordinates are stored as [lng, lat]; convert to Coord.
export function pathPointToCoord(p: [number, number]): Coord {
  return { lng: p[0], lat: p[1] };
}

// Total length of a [lng,lat] polyline in km.
export function pathLengthKm(path: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += haversineKm(pathPointToCoord(path[i - 1]), pathPointToCoord(path[i]));
  }
  return total;
}

// Find the index of the polyline vertex closest to a coordinate.
export function nearestPathIndex(path: [number, number][], c: Coord): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = haversineKm(pathPointToCoord(path[i]), c);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Distribute N intermediate stops evenly (by cumulative distance) along a polyline,
// returning the path index each stop maps to. Endpoints map to first/last vertex.
export function distributeStopsAlongPath(
  path: [number, number][],
  intermediateCount: number,
): number[] {
  if (path.length === 0) return [];
  if (intermediateCount <= 0) return [];
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(
      cum[i - 1] +
        haversineKm(pathPointToCoord(path[i - 1]), pathPointToCoord(path[i])),
    );
  }
  const total = cum[cum.length - 1] || 1;
  const indices: number[] = [];
  for (let k = 1; k <= intermediateCount; k++) {
    const target = (total * k) / (intermediateCount + 1);
    // binary-ish linear scan for nearest cumulative distance
    let idx = 0;
    let bestD = Infinity;
    for (let i = 0; i < cum.length; i++) {
      const d = Math.abs(cum[i] - target);
      if (d < bestD) {
        bestD = d;
        idx = i;
      }
    }
    indices.push(idx);
  }
  return indices;
}

// Slice a [lng,lat] polyline between two vertex indices (inclusive), keeping order.
export function slicePath(
  path: [number, number][],
  from: number,
  to: number,
): [number, number][] {
  if (!path.length) return [];
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(path.length - 1, Math.max(from, to));
  const seg = path.slice(a, b + 1);
  // preserve travel direction (from -> to)
  return from <= to ? seg : seg.reverse();
}

// Sample polyline vertex indices roughly every `spacingKm` (measured by cumulative
// distance), always including the first and last vertex. Used to place virtual
// boarding points along flag-down routes so riders can get on/off near any point.
export function sampleIndicesAlongPath(
  path: [number, number][],
  spacingKm: number,
): number[] {
  if (path.length <= 2) return path.map((_, i) => i);
  const out: number[] = [0];
  let acc = 0;
  for (let i = 1; i < path.length - 1; i++) {
    acc += haversineKm(pathPointToCoord(path[i - 1]), pathPointToCoord(path[i]));
    if (acc >= spacingKm) {
      out.push(i);
      acc = 0;
    }
  }
  out.push(path.length - 1);
  return out;
}
