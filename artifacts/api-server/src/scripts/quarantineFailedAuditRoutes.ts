import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@workspace/db";

type Audit = { routes?: Array<{
  lineId: string;
  governorate?: string;
  fixedGuideway?: boolean;
  verdict?: string;
  activeVersionSource?: string;
  errors?: string[];
}> };

async function main() {
  const governorate = process.argv.find((value) => value.startsWith("--governorate="))?.slice(14);
  const audit = JSON.parse(await readFile(path.resolve("scripts/generated/stored-route-geometry-audit.json"), "utf8")) as Audit;
  const failed = (audit.routes ?? []).filter((route) =>
    route.verdict === "fail"
    // Fixed-guideway services need a rail-specific repair and must never be
    // erased by the road quarantine pass. Everything else that fails the
    // independent audit is made non-drawable, regardless of which generator
    // produced it (Google, Valhalla, a legacy seed, or an unknown source).
    && route.fixedGuideway !== true
    && (!governorate || route.governorate?.toLowerCase() === governorate.toLowerCase()),
  );
  let quarantined = 0;
  for (const route of failed) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ active_geometry_version_id: string | null }>(
        "SELECT active_geometry_version_id FROM transit_lines WHERE id=$1 FOR UPDATE", [route.lineId],
      );
      const versionId = current.rows[0]?.active_geometry_version_id;
      if (versionId) await client.query("UPDATE route_geometry_versions SET status='rejected', rejected_at=NOW(), accepted_at=NULL WHERE id=$1", [versionId]);
      await client.query(`
        UPDATE transit_lines SET route_path=NULL, active_geometry_version_id=NULL, confidence_score=0.3,
          route_status='needs_review', verified_at=NULL,
          needs_review_reason=$2, updated_at=NOW() WHERE id=$1
      `, [route.lineId, `Independent route audit failed: ${(route.errors ?? []).join("; ")}`]);
      await client.query("COMMIT");
      quarantined++;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  console.log(JSON.stringify({ governorate: governorate || "all", failed: failed.length, quarantined }));
}

main().finally(async () => pool.end()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
