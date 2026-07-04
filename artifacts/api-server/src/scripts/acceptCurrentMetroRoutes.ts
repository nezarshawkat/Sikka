import { pool } from "@workspace/db";

type MetroRow = {
  id: string;
  line_number: string | null;
  route_path: { type?: string; coordinates?: [number, number][] } | null;
};

const ACCEPTANCE_SOURCE = "user_accepted_existing_metro_2026_07_04";

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<MetroRow>(`
      SELECT l.id, l.line_number, l.route_path
      FROM transit_lines l
      JOIN transport_types t ON t.id = l.transport_type_id
      WHERE lower(t.name_en) = 'metro' AND l.is_active = true
      ORDER BY l.line_number
      FOR UPDATE OF l
    `);
    if (result.rows.length !== 3) {
      throw new Error(`Expected exactly 3 active Metro lines; found ${result.rows.length}`);
    }

    const accepted: Array<{ lineNumber: string; version: number; pointCount: number }> = [];
    for (const line of result.rows) {
      const coordinates = line.route_path?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        throw new Error(`Metro ${line.line_number ?? line.id} has no usable geometry`);
      }

      const next = await client.query<{ version: number }>(`
        SELECT COALESCE(MAX(version), 0)::int + 1 AS version
        FROM route_geometry_versions
        WHERE transit_line_id = $1
      `, [line.id]);
      const version = next.rows[0].version;

      await client.query(`
        UPDATE route_geometry_versions
        SET status = 'superseded'
        WHERE transit_line_id = $1 AND status = 'accepted'
      `, [line.id]);

      const inserted = await client.query<{ id: string }>(`
        INSERT INTO route_geometry_versions
          (transit_line_id, version, geometry, source, status, quality_score,
           confidence_score, metrics, evidence, created_by, accepted_at)
        VALUES
          ($1, $2, $3::jsonb, $4, 'accepted', 0.85, 0.90, $5::jsonb,
           $6::jsonb, 'codex_user_instruction', NOW())
        RETURNING id
      `, [
        line.id,
        version,
        JSON.stringify(line.route_path),
        ACCEPTANCE_SOURCE,
        JSON.stringify({ pointCount: coordinates.length, geometryChanged: false }),
        JSON.stringify({
          acceptedAsIs: true,
          acceptedBy: "user",
          acceptanceInstruction: "Accept the metro as it is right now",
          geometryChanged: false,
          independentAuditCaveatPreserved: true,
        }),
      ]);

      await client.query(`
        UPDATE transit_lines
        SET active_geometry_version_id = $2,
            route_status = 'active',
            confidence_score = 0.90,
            geometry_locked = true,
            verified_at = NOW(),
            last_confirmed_at = NOW(),
            needs_review_reason = NULL,
            updated_at = NOW()
        WHERE id = $1
      `, [line.id, inserted.rows[0].id]);

      accepted.push({
        lineNumber: line.line_number ?? line.id,
        version,
        pointCount: coordinates.length,
      });
    }

    await client.query("COMMIT");
    console.log(JSON.stringify({ source: ACCEPTANCE_SOURCE, geometryChanged: false, accepted }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

main().finally(async () => pool.end()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
