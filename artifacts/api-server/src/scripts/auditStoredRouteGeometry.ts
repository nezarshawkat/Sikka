import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@workspace/db";

type LngLat = [number, number];
type Row = {
  id: string;
  label: string;
  governorate: string;
  transport_name: string;
  route_path: { coordinates?: LngLat[] } | null;
  stops: { name?: string; lat: number; lng: number }[] | null;
  confidence_score: number;
  route_status: string;
  route_quality: Record<string, unknown> | null;
  version_source: string | null;
  version_metrics: Record<string, unknown> | null;
  evidence: Record<string, unknown> | null;
};

const FIXED_GUIDEWAY = /metro|monorail|tram|train|rail|lrt|subway/i;
const OUTPUT = path.resolve(process.cwd(), "scripts/generated/stored-route-geometry-audit.json");

function haversineKm(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
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

function inspect(row: Row) {
  const points = row.route_path?.coordinates?.filter((point) =>
    Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]),
  ) ?? [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const fixed = FIXED_GUIDEWAY.test(row.transport_name);
  const selectedAnchors = Array.isArray(row.version_metrics?.selectedAnchors)
    ? row.version_metrics.selectedAnchors as Array<{ name?: string; lat?: number; lng?: number }>
    : [];
  if (points.length < 2) errors.push("missing geometry");
  if (points.some(([lng, lat]) => lat < 21.5 || lat > 31.8 || lng < 24.5 || lng > 36.9)) errors.push("coordinate outside Egypt bounds");

  let lengthKm = 0;
  let maxStepKm = 0;
  const cumulative = [0];
  for (let index = 1; index < points.length; index++) {
    const step = haversineKm(points[index - 1], points[index]);
    lengthKm += step;
    maxStepKm = Math.max(maxStepKm, step);
    cumulative.push(lengthKm);
  }
  const directKm = points.length >= 2 ? haversineKm(points[0], points[points.length - 1]) : 0;
  const detourRatio = directKm > 0.5 ? lengthKm / directKm : null;
  if (maxStepKm > 3) errors.push(`geometry jump ${maxStepKm.toFixed(2)} km`);
  if (selectedAnchors.length < 3 && detourRatio !== null && detourRatio > 6) errors.push(`detour ratio ${detourRatio.toFixed(2)}`);

  // Re-entering the same ~110m cell after travelling >2km usually indicates
  // the destructive loops that triggered this repair. Adjacent parallel
  // carriageways do not trigger it because the travelled separation is used.
  const cells = new Map<string, { index: number; distance: number }>();
  let loopReentries = 0;
  const reentryIndexes: number[] = [];
  for (let index = 0; index < points.length; index++) {
    const [lng, lat] = points[index];
    const key = `${Math.round(lng * 1000)}:${Math.round(lat * 1000)}`;
    const previous = cells.get(key);
    if (previous && index - previous.index > 8 && cumulative[index] - previous.distance > 2) reentryIndexes.push(index);
    cells.set(key, { index, distance: cumulative[index] });
  }
  let runLength = 0;
  let previousReentry = -10;
  for (const index of reentryIndexes) {
    runLength = index - previousReentry <= 2 ? runLength + 1 : 1;
    if (runLength === 4) loopReentries++;
    previousReentry = index;
  }
  if (loopReentries > 0) errors.push(`${loopReentries} long loop re-entry/re-entries`);

  let anchorOrderViolations = 0;
  let previousAnchorIndex = -1;
  for (const anchor of selectedAnchors) {
    if (!Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lng)) continue;
    let forwardDistance = Infinity;
    let forwardIndex = -1;
    for (let index = Math.max(0, previousAnchorIndex); index < points.length; index++) {
      const distance = haversineKm(points[index], [Number(anchor.lng), Number(anchor.lat)]);
      if (distance < forwardDistance) {
        forwardDistance = distance;
        forwardIndex = index;
      }
    }
    if (forwardDistance > 0.75) {
      let globalDistance = Infinity;
      for (const point of points) globalDistance = Math.min(globalDistance, haversineKm(point, [Number(anchor.lng), Number(anchor.lat)]));
      if (globalDistance <= 0.75) anchorOrderViolations++;
      else errors.push(`anchor "${anchor.name || "unnamed"}" is ${globalDistance.toFixed(2)} km from geometry`);
    } else {
      previousAnchorIndex = forwardIndex;
    }
  }
  if (anchorOrderViolations) errors.push(`${anchorOrderViolations} ordered anchor progression violation(s)`);
  if (!fixed && row.version_source === "google_directions_licensed_study" && selectedAnchors.length < 2) {
    warnings.push("active Google version lacks a stored ordered-anchor audit trail");
  }
  const anchorChainKm = selectedAnchors.length >= 2
    ? selectedAnchors.slice(1).reduce((sum, anchor, index) => sum + haversineKm(
      [Number(selectedAnchors[index].lng), Number(selectedAnchors[index].lat)],
      [Number(anchor.lng), Number(anchor.lat)],
    ), 0)
    : directKm;
  const corridorEfficiency = lengthKm > 0 ? anchorChainKm / lengthKm : 0;
  const corridorExcessFactor = anchorChainKm > 0 ? lengthKm / anchorChainKm : Infinity;
  const repeatedRatio = repeatedTraversalRatio(points);
  const maximumExcessFactor = selectedAnchors.length >= 3 ? 2 : 2.5;
  if (corridorExcessFactor > maximumExcessFactor) errors.push(`route is ${corridorExcessFactor.toFixed(2)}x its ${selectedAnchors.length >= 3 ? "ordered anchor chain" : "endpoint displacement"}`);
  if (repeatedRatio > 0.1) errors.push(`repeated traversal ratio is ${(repeatedRatio * 100).toFixed(1)}%`);

  let stopMisses = 0;
  for (const stop of row.stops ?? []) {
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) continue;
    let nearest = Infinity;
    for (const point of points) nearest = Math.min(nearest, haversineKm(point, [stop.lng, stop.lat]));
    if (nearest > 0.75) stopMisses++;
  }
  if (stopMisses) errors.push(`${stopMisses} ordered stop(s) over 750m from geometry`);

  if (fixed && row.version_source === "google_directions_licensed_study") errors.push("fixed guideway incorrectly contains driving geometry");
  if (!fixed && row.version_source !== "google_directions_licensed_study") warnings.push("road route is not the licensed Google regeneration version");
  if (row.route_status !== "active") errors.push(`route status is ${row.route_status}`);
  if (row.confidence_score < 0.9) warnings.push(`confidence is ${row.confidence_score}`);

  return {
    lineId: row.id,
    label: row.label,
    governorate: row.governorate,
    transportType: row.transport_name,
    fixedGuideway: fixed,
    verdict: errors.length ? "fail" : warnings.length ? "review" : "pass",
    pointCount: points.length,
    lengthKm,
    directKm,
    detourRatio,
    maxStepKm,
    loopReentries,
    anchorOrderViolations,
    selectedAnchorCount: selectedAnchors.length,
    anchorChainKm,
    corridorEfficiency,
    corridorExcessFactor,
    repeatedRatio,
    stopMisses,
    confidenceScore: row.confidence_score,
    activeVersionSource: row.version_source,
    evidence: row.evidence,
    errors,
    warnings,
  };
}

async function main() {
  const result = await pool.query<Row>(`
    SELECT l.id, l.governorate,
           CONCAT(t.name_en, ' ', COALESCE(l.line_number, NULLIF(l.name_en, ''), l.id::text)) AS label,
           t.name_en AS transport_name,
           l.route_path, l.stops, l.confidence_score, l.route_status, l.route_quality,
           v.source AS version_source, v.metrics AS version_metrics, v.evidence
    FROM transit_lines l
    JOIN transport_types t ON t.id = l.transport_type_id
    LEFT JOIN route_geometry_versions v ON v.id = l.active_geometry_version_id
    WHERE l.is_active = TRUE
    ORDER BY t.name_en, l.line_number NULLS LAST, l.id
  `);
  const routes = result.rows.map(inspect);
  const totals = {
    routes: routes.length,
    pass: routes.filter((route) => route.verdict === "pass").length,
    review: routes.filter((route) => route.verdict === "review").length,
    fail: routes.filter((route) => route.verdict === "fail").length,
    highConfidence: routes.filter((route) => route.confidenceScore >= 0.9).length,
  };
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), totals, routes }, null, 2));
  console.table(totals);
  console.log(`Audit: ${OUTPUT}`);
  if (process.argv.includes("--require-all") && (totals.fail > 0 || totals.review > 0)) process.exitCode = 2;
}

main().finally(async () => pool.end()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
