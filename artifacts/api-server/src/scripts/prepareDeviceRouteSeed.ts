import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@workspace/db";
import { buildOfflinePayload } from "../routes/offlineSnapshot";

type AuditRoute = {
  lineId: string;
  label: string;
  governorate: string;
  transportType: string;
  fixedGuideway: boolean;
  verdict: "pass" | "review" | "fail";
  pointCount: number;
};

const PREPARED_PATH = path.resolve("scripts/generated/prepared-device-route-seed.json");
const MANIFEST_PATH = path.resolve("scripts/generated/prepared-device-route-seed-manifest.json");
const METRO_ACCEPTANCE_SOURCE = "user_accepted_existing_metro_2026_07_04";

async function main() {
  const auditPath = path.resolve("scripts/generated/stored-route-geometry-audit.json");
  const audit = JSON.parse(await readFile(auditPath, "utf8")) as { routes?: AuditRoute[] };
  const routes = audit.routes ?? [];
  if (!routes.length) throw new Error("Stored-route audit is empty; run the audit first");

  const badDrawableRoads = routes.filter((route) =>
    !route.fixedGuideway && route.verdict === "fail" && route.pointCount >= 2,
  );
  if (badDrawableRoads.length) {
    throw new Error(`Refusing to prepare: ${badDrawableRoads.length} failed road route(s) are still drawable`);
  }

  const metroAccepted = await pool.query<{ line_id: string }>(`
    SELECT l.id AS line_id
    FROM transit_lines l
    JOIN transport_types t ON t.id = l.transport_type_id
    JOIN route_geometry_versions v ON v.id = l.active_geometry_version_id
    WHERE lower(t.name_en) = 'metro'
      AND l.is_active = true
      AND l.route_status = 'active'
      AND v.status = 'accepted'
      AND v.source = $1
  `, [METRO_ACCEPTANCE_SOURCE]);
  if (metroAccepted.rows.length !== 3) {
    throw new Error(`Expected 3 explicitly accepted Metro lines; found ${metroAccepted.rows.length}`);
  }

  const acceptedIds = new Set(routes.filter((route) => route.verdict === "pass").map((route) => route.lineId));
  for (const row of metroAccepted.rows) acceptedIds.add(row.line_id);

  const payload = await buildOfflinePayload();
  const prepared = {
    ...payload,
    generatedAt: new Date().toISOString(),
    lines: payload.lines.filter((line) => acceptedIds.has(line.id)),
  };
  if (!prepared.lines.length) throw new Error("Refusing to prepare an empty device route seed");

  const missing = [...acceptedIds].filter((id) => !prepared.lines.some((line) => line.id === id));
  if (missing.length) throw new Error(`Refusing to prepare: ${missing.length} accepted route(s) are absent from payload`);

  const serialized = `${JSON.stringify(prepared, null, 2)}\n`;
  const sha256 = createHash("sha256").update(serialized).digest("hex");
  const routeById = new Map(routes.map((route) => [route.lineId, route]));
  const counts: Record<string, number> = {};
  for (const line of prepared.lines) {
    const route = routeById.get(line.id);
    const key = `${route?.governorate ?? "Unknown"} / ${route?.transportType ?? "Unknown"}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }

  const manifest = {
    ready: true,
    preparedAt: prepared.generatedAt,
    preparedPath: PREPARED_PATH,
    targetWhenSeeded: path.resolve("artifacts/sikka/src/data/bundledSnapshot.json"),
    sha256,
    routeCount: prepared.lines.length,
    transportTypeCount: prepared.types.length,
    selectionPolicy: "independent-audit-pass plus explicit current-Metro acceptance",
    excludedReviewCount: routes.filter((route) => route.verdict === "review").length,
    excludedFailedRoadCount: routes.filter((route) => !route.fixedGuideway && route.verdict === "fail").length,
    excludedUnacceptedFixedGuidewayFailures: routes
      .filter((route) => route.fixedGuideway && route.verdict === "fail" && route.transportType !== "Metro")
      .map((route) => route.label),
    counts,
  };

  await mkdir(path.dirname(PREPARED_PATH), { recursive: true });
  await writeFile(PREPARED_PATH, serialized);
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
  console.log("Prepared only. The app bundle was NOT seeded.");
}

main().finally(async () => pool.end()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
