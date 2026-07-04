import { pool } from "@workspace/db";

type LngLat = [number, number];
type Anchor = { name?: string; lat?: number; lng?: number; source?: string };
type Row = {
  line_id: string;
  label: string;
  active_version_id: string;
  route_path: { coordinates?: LngLat[] } | null;
  candidate_anchors: Anchor[] | null;
};

function haversineKm(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function validateOrdered(points: LngLat[], anchors: Anchor[]): { accepted: boolean; misses: string[] } {
  let minimumIndex = 0;
  const misses: string[] = [];
  for (const anchor of anchors) {
    if (!Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lng)) {
      misses.push(`${anchor.name ?? "unnamed"}: invalid coordinate`);
      continue;
    }
    let bestIndex = -1;
    let bestKm = Number.POSITIVE_INFINITY;
    for (let index = minimumIndex; index < points.length; index++) {
      const km = haversineKm(points[index], [Number(anchor.lng), Number(anchor.lat)]);
      if (km < bestKm) {
        bestKm = km;
        bestIndex = index;
      }
    }
    if (bestKm > 0.75) misses.push(`${anchor.name ?? "unnamed"}: ${bestKm.toFixed(2)} km`);
    else minimumIndex = bestIndex;
  }
  return { accepted: anchors.length >= 2 && misses.length === 0, misses };
}

async function main(): Promise<void> {
  const result = await pool.query<Row>(`
    SELECT l.id AS line_id,
           CONCAT(t.name_en, ' ', COALESCE(l.line_number, l.name_en)) AS label,
           active.id AS active_version_id,
           l.route_path,
           candidate.metrics->'selectedAnchors' AS candidate_anchors
    FROM transit_lines l
    JOIN transport_types t ON t.id = l.transport_type_id
    JOIN route_geometry_versions active ON active.id = l.active_geometry_version_id
    JOIN LATERAL (
      SELECT v.metrics
      FROM route_geometry_versions v
      WHERE v.transit_line_id = l.id
        AND v.id <> active.id
        AND jsonb_array_length(COALESCE(v.metrics->'selectedAnchors', '[]'::jsonb)) >= 2
      ORDER BY v.created_at DESC
      LIMIT 1
    ) candidate ON TRUE
    WHERE l.is_active = TRUE
      AND active.source = 'google_directions_licensed_study'
      AND jsonb_array_length(COALESCE(active.metrics->'selectedAnchors', '[]'::jsonb)) < 2
  `);
  let updated = 0;
  const report: Array<Record<string, unknown>> = [];
  for (const row of result.rows) {
    const points = row.route_path?.coordinates ?? [];
    const anchors = row.candidate_anchors ?? [];
    const validation = validateOrdered(points, anchors);
    if (!validation.accepted) {
      report.push({ label: row.label, status: "rejected", misses: validation.misses });
      continue;
    }
    await pool.query(`
      UPDATE route_geometry_versions
      SET metrics = jsonb_set(metrics, '{selectedAnchors}', $2::jsonb, TRUE),
          evidence = evidence || jsonb_build_object(
            'anchorTrailBackfilledAt', NOW(),
            'anchorTrailBackfillMethod', 'newer candidate anchors independently matched active geometry in order'
          )
      WHERE id = $1
    `, [row.active_version_id, JSON.stringify(anchors)]);
    updated++;
    report.push({ label: row.label, status: "updated", anchorCount: anchors.length });
  }
  console.log(JSON.stringify({ selected: result.rows.length, updated, routes: report }, null, 2));
}

main().finally(async () => pool.end()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
