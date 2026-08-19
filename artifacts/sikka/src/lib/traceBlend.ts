export type LngLat = [number, number];

export interface ColoredTrace {
  trace: LngLat[];
  color: string;
}

export interface BlendedSegment {
  coordinates: [LngLat, LngLat];
  color: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Averages a set of hex colors' RGB channels -- the "two colors mixed
 *  together yield a new one" effect used wherever two or more contributors'
 *  traces run along the same stretch of road. */
export function mixColors(colors: string[]): string {
  if (colors.length === 0) return '#3B82F6';
  if (colors.length === 1) return colors[0];
  const sum = colors.reduce(
    (acc, c) => {
      const [r, g, b] = hexToRgb(c);
      return [acc[0] + r, acc[1] + g, acc[2] + b] as [number, number, number];
    },
    [0, 0, 0] as [number, number, number],
  );
  return rgbToHex(sum[0] / colors.length, sum[1] / colors.length, sum[2] / colors.length);
}

export function haversineMeters(a: LngLat, b: LngLat): number {
  const R = 6371000;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Resamples a trace to roughly evenly-spaced points so overlap detection
 *  between traces of different point densities is consistent. */
function resampleTrace(trace: LngLat[], stepMeters = 20): LngLat[] {
  if (trace.length < 2) return trace;
  const out: LngLat[] = [trace[0]];
  let carry = 0;
  for (let i = 1; i < trace.length; i++) {
    let segStart = trace[i - 1];
    const segEnd = trace[i];
    let segLen = haversineMeters(segStart, segEnd);
    let guard = 0;
    while (carry + segLen >= stepMeters && guard < 1000) {
      guard++;
      const remain = stepMeters - carry;
      const t = segLen > 0 ? remain / segLen : 1;
      const lng = segStart[0] + (segEnd[0] - segStart[0]) * t;
      const lat = segStart[1] + (segEnd[1] - segStart[1]) * t;
      out.push([lng, lat]);
      segStart = [lng, lat];
      segLen = haversineMeters(segStart, segEnd);
      carry = 0;
    }
    carry += segLen;
  }
  out.push(trace[trace.length - 1]);
  return out;
}

/**
 * Builds short, individually-colored line segments from a set of
 * contributor traces: segments where only one trace runs keep that
 * contributor's own color; segments where two or more traces run close
 * together (within `thresholdM`) get the blended/mixed color of everyone
 * overlapping there -- visually showing where multiple riders' reports
 * agree on the same stretch of road.
 */
export function buildBlendedSegments(tracesIn: ColoredTrace[], thresholdM = 30): BlendedSegment[] {
  const usable = tracesIn.filter((t) => t.trace.length >= 2);
  if (usable.length === 0) return [];
  const resampled = usable.map((t) => ({ color: t.color, points: resampleTrace(t.trace, 20) }));
  const segments: BlendedSegment[] = [];

  resampled.forEach((current, idx) => {
    let prevPoint: LngLat | null = null;
    for (const p of current.points) {
      const overlapping: string[] = [current.color];
      resampled.forEach((other, oIdx) => {
        if (oIdx === idx) return;
        const near = other.points.some((op) => haversineMeters(p, op) <= thresholdM);
        if (near) overlapping.push(other.color);
      });
      const uniqueColors = Array.from(new Set(overlapping)).sort();
      const segColor = uniqueColors.length > 1 ? mixColors(uniqueColors) : current.color;
      if (prevPoint) {
        segments.push({ coordinates: [prevPoint, p], color: segColor });
      }
      prevPoint = p;
    }
  });

  return segments;
}

/** Bounding box [[minLng,minLat],[maxLng,maxLat]] for fitting a map view. */
export function computeBounds(points: LngLat[]): [LngLat, LngLat] | null {
  if (!points.length) return null;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (minLng === maxLng && minLat === maxLat) {
    // Single point -- pad slightly so fitBounds doesn't zoom to infinity.
    const pad = 0.003;
    return [[minLng - pad, minLat - pad], [maxLng + pad, maxLat + pad]];
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}
