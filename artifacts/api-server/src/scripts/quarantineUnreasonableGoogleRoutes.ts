import { pool } from "@workspace/db";

type LngLat = [number, number];
const FIXED_GUIDEWAY = /metro|monorail|tram|train|rail|lrt|subway/i;

function distanceKm(a: LngLat, b: LngLat) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function inspect(points: LngLat[]) {
  let lengthKm = 0;
  let maxStepKm = 0;
  const cumulative = [0];
  for (let index = 1; index < points.length; index++) {
    const step = distanceKm(points[index - 1], points[index]);
    lengthKm += step;
    maxStepKm = Math.max(maxStepKm, step);
    cumulative.push(lengthKm);
  }
  const visited = new Map<string, { index: number; distance: number }>();
  const reentries: number[] = [];
  for (let index = 0; index < points.length; index++) {
    const [lng, lat] = points[index];
    const key = `${Math.round(lng * 1000)}:${Math.round(lat * 1000)}`;
    const previous = visited.get(key);
    if (previous && index - previous.index > 8 && cumulative[index] - previous.distance > 2) reentries.push(index);
    visited.set(key, { index, distance: cumulative[index] });
  }
  let loopRuns = 0;
  let run = 0;
  let previous = -10;
  for (const index of reentries) {
    run = index - previous <= 2 ? run + 1 : 1;
    if (run === 4) loopRuns++;
    previous = index;
  }
  const traversed = new Set<string>();
  let repeatedKm = 0;
  let sampledKm = 0;
  const cell = ([lng, lat]: LngLat) => `${Math.round(lng * 2000)}:${Math.round(lat * 2000)}`;
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1];
    const end = points[index];
    const km = distanceKm(start, end);
    const pieces = Math.max(1, Math.ceil(km / 0.05));
    let previousCell = cell(start);
    for (let piece = 1; piece <= pieces; piece++) {
      const ratio = piece / pieces;
      const current: LngLat = [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
      const currentCell = cell(current);
      const pieceKm = km / pieces;
      sampledKm += pieceKm;
      if (currentCell !== previousCell) {
        const edge = previousCell < currentCell ? `${previousCell}|${currentCell}` : `${currentCell}|${previousCell}`;
        if (traversed.has(edge)) repeatedKm += pieceKm;
        else traversed.add(edge);
      }
      previousCell = currentCell;
    }
  }
  return { lengthKm, maxStepKm, loopRuns, repeatedRatio: sampledKm > 0 ? repeatedKm / sampledKm : 0 };
}

async function main() {
  const governorate = process.argv.find((value) => value.startsWith("--governorate="))?.slice(14);
  const result = await pool.query<{
    line_id: string; version_id: string; transport_name: string; geometry: { coordinates?: LngLat[] };
    metrics: { selectedAnchors?: Array<{ lat?: number; lng?: number }> } | null;
  }>(`
    SELECT l.id AS line_id, v.id AS version_id, t.name_en AS transport_name, v.geometry, v.metrics
    FROM transit_lines l
    JOIN transport_types t ON t.id=l.transport_type_id
    JOIN route_geometry_versions v ON v.id=l.active_geometry_version_id
    WHERE l.is_active=TRUE AND v.source='google_directions_licensed_study'
      AND ($1::text IS NULL OR LOWER(l.governorate)=LOWER($1::text))
  `, [governorate || null]);
  let quarantined = 0;
  const reasons: Record<string, number> = {};
  for (const row of result.rows) {
    if (FIXED_GUIDEWAY.test(row.transport_name)) continue;
    const points = row.geometry?.coordinates ?? [];
    const metrics = inspect(points);
    const anchors = Array.isArray(row.metrics?.selectedAnchors) ? row.metrics!.selectedAnchors! : [];
    const anchorChainKm = anchors.length >= 2
      ? anchors.slice(1).reduce((sum, anchor, index) => sum + distanceKm(
        [Number(anchors[index].lng), Number(anchors[index].lat)],
        [Number(anchor.lng), Number(anchor.lat)],
      ), 0)
      : 0;
    const corridorExcessFactor = anchorChainKm > 0 ? metrics.lengthKm / anchorChainKm : Infinity;
    const maximumExcessFactor = anchors.length >= 3 ? 2 : 2.5;
    const failures = [
      ...(points.length < 2 ? ["missing_geometry"] : []),
      ...(anchors.length < 2 ? ["missing_anchor_trail"] : []),
      ...(anchors.length >= 2 && corridorExcessFactor > maximumExcessFactor ? ["excessive_corridor_detour"] : []),
      ...(metrics.maxStepKm > 3 ? ["corner_cut_jump"] : []),
      ...(metrics.loopRuns > 0 ? ["repeated_corridor_loop"] : []),
      ...(metrics.repeatedRatio > 0.1 ? ["over_10_percent_repeated"] : []),
    ];
    if (!failures.length) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE route_geometry_versions SET status='rejected', rejected_at=NOW(), accepted_at=NULL WHERE id=$1`, [row.version_id]);
      await client.query(`
        UPDATE transit_lines SET route_path=NULL, active_geometry_version_id=NULL,
          confidence_score=0.3, route_status='needs_review',
          needs_review_reason=$2, updated_at=NOW()
        WHERE id=$1
      `, [row.line_id, `Quarantined by independent audit: ${failures.join(", ")}`]);
      await client.query("COMMIT");
      quarantined++;
      for (const failure of failures) reasons[failure] = (reasons[failure] || 0) + 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  console.log(JSON.stringify({ inspected: result.rows.length, quarantined, reasons }, null, 2));
}

main().finally(async () => pool.end()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
