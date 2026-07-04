import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@workspace/db";

type Snapshot = { lines?: Array<{
  id: string; path?: [number, number][]; confidenceScore?: number; routeStatus?: string;
  needsReviewReason?: string | null;
}> };

async function main() {
  const snapshotPath = path.resolve("artifacts/sikka/src/data/bundledSnapshot.json");
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as Snapshot;
  const fallback = new Map((snapshot.lines ?? []).map((line) => [line.id, line]));
  const client = await pool.connect();
  let restoredVersion = 0;
  let restoredSnapshot = 0;
  try {
    const active = await client.query<{ line_id: string; version_id: string }>(`
      SELECT l.id AS line_id, v.id AS version_id
      FROM transit_lines l
      JOIN route_geometry_versions v ON v.id = l.active_geometry_version_id
      WHERE v.source = 'google_directions_licensed_study' AND v.confidence_score < 0.9
    `);
    for (const row of active.rows) {
      await client.query("BEGIN");
      const previous = await client.query<{ id: string; geometry: unknown; confidence_score: number }>(`
        SELECT id, geometry, confidence_score
        FROM route_geometry_versions
        WHERE transit_line_id = $1 AND id <> $2 AND status = 'accepted'
          AND (
            (source = 'google_directions_licensed_study' AND confidence_score >= 0.9)
            OR source IN ('gtfs', 'discovery', 'manual_admin', 'admin_gps')
          )
        ORDER BY version DESC LIMIT 1
      `, [row.line_id, row.version_id]);
      if (previous.rows[0]) {
        await client.query(`
          UPDATE transit_lines SET route_path=$2::jsonb, active_geometry_version_id=$3,
            confidence_score=$4::real, route_status='needs_review',
            needs_review_reason='Restored after rejecting an under-constrained Google candidate', updated_at=NOW()
          WHERE id=$1
        `, [row.line_id, JSON.stringify(previous.rows[0].geometry), previous.rows[0].id, previous.rows[0].confidence_score]);
        restoredVersion++;
      } else {
        await client.query(`
          UPDATE transit_lines SET route_path=NULL, active_geometry_version_id=NULL,
            confidence_score=0.3, route_status='needs_review',
            needs_review_reason='No proven corridor geometry; under-constrained Google candidate was not published', updated_at=NOW()
          WHERE id=$1
        `, [row.line_id]);
        restoredSnapshot++;
      }
      await client.query("UPDATE route_geometry_versions SET status='candidate', accepted_at=NULL WHERE id=$1", [row.version_id]);
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  console.log(JSON.stringify({ restoredVersion, restoredSnapshot, total: restoredVersion + restoredSnapshot }));
}

main().finally(async () => pool.end()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
