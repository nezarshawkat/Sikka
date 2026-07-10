import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

type PreparedType = {
  id: string; nameEn: string; nameAr: string; icon: string; color: string;
  category: string; governmentType: string; averageSpeedKmh: number;
  basePriceEgp: number; pricePerKmEgp: number;
};

type PreparedLine = {
  id: string; transportTypeId: string; lineNumber: string | null; nameEn: string; nameAr: string;
  fromArea: string; toArea: string; governorate: string; viaStops: string[];
  stops?: unknown; path: [number, number][]; dataSource?: string; sourcePriority?: number;
  confidenceScore?: number; routeStatus?: string; routeQualityDetails?: unknown;
  geometryLocked?: boolean; verifiedAt?: string | null; lastConfirmedAt?: string | null;
  needsReviewReason?: string | null; reviewReportCount?: number; priceEgp: number;
  frequencyMinutes?: number | null; observedSpeedKmh?: number | null; hasFixedStops: boolean;
};

async function main() {
  const validateOnly = process.argv.includes("--validate-only");
  if (!validateOnly && !process.argv.includes("--confirm-replace")) {
    throw new Error("No backend changes made. Re-run with --confirm-replace after explicit approval.");
  }
  const preparedPath = path.resolve("scripts/generated/prepared-device-route-seed.json");
  const manifestPath = path.resolve("scripts/generated/prepared-device-route-seed-manifest.json");
  const [preparedBytes, manifestBytes] = await Promise.all([readFile(preparedPath), readFile(manifestPath)]);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as { ready?: boolean; sha256?: string; routeCount?: number };
  const hash = createHash("sha256").update(preparedBytes).digest("hex");
  if (!manifest.ready || !manifest.sha256 || manifest.sha256 !== hash) {
    throw new Error("Prepared seed hash does not match its readiness manifest");
  }
  const prepared = JSON.parse(preparedBytes.toString("utf8")) as { types: PreparedType[]; lines: PreparedLine[] };
  if (!Array.isArray(prepared.lines) || prepared.lines.length !== manifest.routeCount || prepared.lines.length !== 521) {
    throw new Error(`Expected the audited 521-route seed; found ${prepared.lines?.length ?? 0}`);
  }
  for (const line of prepared.lines) {
    if (!line.id || !line.transportTypeId || !Array.isArray(line.path) || line.path.length < 2) {
      throw new Error(`Prepared route ${line.id || "unknown"} is incomplete`);
    }
  }
  if (validateOnly) {
    console.log(JSON.stringify({ ready: true, routes: prepared.lines.length, types: prepared.types.length, hash }, null, 2));
    return;
  }

  const { pool } = await import("@workspace/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const type of prepared.types) {
      await client.query(`
        INSERT INTO transport_types
          (id, name_en, name_ar, icon, color, category, government_type,
           average_speed_kmh, base_price_egp, price_per_km_egp, is_active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
        ON CONFLICT (id) DO UPDATE SET
          name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, icon=EXCLUDED.icon,
          color=EXCLUDED.color, category=EXCLUDED.category,
          government_type=EXCLUDED.government_type,
          average_speed_kmh=EXCLUDED.average_speed_kmh,
          base_price_egp=EXCLUDED.base_price_egp,
          price_per_km_egp=EXCLUDED.price_per_km_egp,
          is_active=true
      `, [type.id, type.nameEn, type.nameAr, type.icon, type.color, type.category,
        type.governmentType, type.averageSpeedKmh, type.basePriceEgp, type.pricePerKmEgp]);
    }

    for (const line of prepared.lines) {
      const geometry = { type: "LineString", coordinates: line.path };
      await client.query(`
        INSERT INTO transit_lines
          (id, transport_type_id, line_number, name_en, name_ar, from_area, to_area,
           governorate, via_stops, stops, route_path, data_source, source_priority,
           confidence_score, route_status, geometry_locked, route_quality, verified_at,
           last_confirmed_at, needs_review_reason, review_report_count, price_egp,
           frequency_minutes, observed_speed_kmh, has_fixed_stops, is_active,
           route_direction, updated_at)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10::jsonb,$11::jsonb,$12,$13,$14,
           $15,$16,$17::jsonb,$18,$19,$20,$21,$22,$23,$24,$25,true,'forward',NOW())
        ON CONFLICT (id) DO UPDATE SET
          transport_type_id=EXCLUDED.transport_type_id, line_number=EXCLUDED.line_number,
          name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar,
          from_area=EXCLUDED.from_area, to_area=EXCLUDED.to_area,
          governorate=EXCLUDED.governorate, via_stops=EXCLUDED.via_stops,
          stops=EXCLUDED.stops,
          route_path=EXCLUDED.route_path,
          active_geometry_version_id=NULL,
          data_source=EXCLUDED.data_source, source_priority=EXCLUDED.source_priority,
          confidence_score=EXCLUDED.confidence_score,
          route_status=EXCLUDED.route_status, geometry_locked=EXCLUDED.geometry_locked,
          route_quality=EXCLUDED.route_quality,
          verified_at=EXCLUDED.verified_at,
          last_confirmed_at=EXCLUDED.last_confirmed_at,
          needs_review_reason=EXCLUDED.needs_review_reason, review_report_count=EXCLUDED.review_report_count,
          price_egp=EXCLUDED.price_egp, frequency_minutes=EXCLUDED.frequency_minutes,
          observed_speed_kmh=EXCLUDED.observed_speed_kmh,
          has_fixed_stops=EXCLUDED.has_fixed_stops, is_active=true, updated_at=NOW()
      `, [
        line.id, line.transportTypeId, line.lineNumber, line.nameEn, line.nameAr,
        line.fromArea, line.toArea, line.governorate || "Cairo", line.viaStops ?? [],
        JSON.stringify(line.stops ?? null), JSON.stringify(geometry), line.dataSource || "seed",
        line.sourcePriority ?? 10, line.confidenceScore ?? 0.9, line.routeStatus || "active",
        line.geometryLocked ?? false, JSON.stringify(line.routeQualityDetails ?? {}),
        line.verifiedAt || null, line.lastConfirmedAt || null, line.needsReviewReason || null,
        line.reviewReportCount ?? 0, line.priceEgp ?? 0, line.frequencyMinutes ?? null,
        line.observedSpeedKmh ?? null, line.hasFixedStops,
      ]);
    }

    const ids = prepared.lines.map((line) => line.id);
    const deactivated = await client.query(`
      UPDATE transit_lines
      SET is_active=false, route_status='inactive', route_path=NULL,
          active_geometry_version_id=NULL,
          needs_review_reason='Excluded from audited 2026-07-04 device/backend seed',
          updated_at=NOW()
      WHERE NOT (id = ANY($1::uuid[])) AND is_active=true
      RETURNING id
    `, [ids]);
    const count = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count FROM transit_lines
      WHERE is_active=true AND route_status='active' AND route_path IS NOT NULL
    `);
    const expectedActiveDrawable = prepared.lines.filter((line) => (line.routeStatus || "active") === "active").length;
    const needsReviewRoutes = prepared.lines.length - expectedActiveDrawable;
    if (Number(count.rows[0]?.count ?? 0) !== expectedActiveDrawable) {
      throw new Error(`Post-apply active-route count is ${count.rows[0]?.count}; expected ${expectedActiveDrawable}`);
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ applied: prepared.lines.length, deactivated: deactivated.rowCount, activeDrawableRoutes: Number(count.rows[0].count), needsReviewRoutes, hash }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
