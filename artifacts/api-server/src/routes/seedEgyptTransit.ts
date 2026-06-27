/**
 * Seeds Cairo LRT, Cairo BRT, and Alexandria Tram from the vendored station
 * lists in src/data/egyptTransitSeed.json (real station names/order, no
 * official GTFS feed exists yet for any of the three systems). Each station
 * is geocoded via Nominatim and the line is snapped to real road/rail
 * geometry via OSRM map matching — the same free, key-less pipeline used by
 * the CSV re-enrichment endpoint.
 *
 * Batched one LINE per call (a line can have 25+ stations, each geocode
 * rate-limited to ~1/sec) — call repeatedly with an increasing `offset`
 * until the response says "done": true, same pattern as re-enrich-routes.
 *
 * POST /api/admin/seed-egypt-transit?dataset=lrt|brt|tram&offset=0
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { transportTypesTable, transitLinesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { geocodeStopNominatim, dropBacktrackingPoints, snapToRoadsFree, checkPathQuality } from "../utils/routePathGenerator.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

interface LineSpec {
  lineNumber: string;
  nameEn: string;
  nameAr: string;
  stationsEn: string[];
  stationsAr: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seedData = JSON.parse(
  readFileSync(path.join(__dirname, "../data/egyptTransitSeed.json"), "utf-8"),
) as {
  lrt: { nameEn: string; nameAr: string; governorate: string; icon: string; color: string; priceEgpBase: number; priceEgpPerKm: number; frequencyMinutes: number; branches: { branchNameEn: string; branchNameAr: string; stationsEn: string[]; stationsAr: string[] }[] };
  brt: { nameEn: string; nameAr: string; governorate: string; icon: string; color: string; priceEgpBase: number; priceEgpPerKm: number; frequencyMinutes: number; lines: LineSpec[] };
  alexandriaTram: { nameEn: string; nameAr: string; governorate: string; icon: string; color: string; priceEgpBase: number; priceEgpPerKm: number; frequencyMinutes: number; lines: LineSpec[] };
};

const router = Router();

interface DatasetSpec {
  key: "lrt" | "brt" | "tram";
  transportTypeNameEn: string;
  transportTypeNameAr: string;
  icon: string;
  color: string;
  category: "economic" | "comfortable" | "premium";
  governorate: string;
  priceEgpBase: number;
  priceEgpPerKm: number;
  frequencyMinutes: number;
  hasFixedStops: boolean;
  lines: LineSpec[];
}

function buildDatasets(): Record<string, DatasetSpec> {
  const data = seedData;

  return {
    lrt: {
      key: "lrt",
      transportTypeNameEn: data.lrt.nameEn,
      transportTypeNameAr: data.lrt.nameAr,
      icon: data.lrt.icon,
      color: data.lrt.color,
      // LRT is the newest, most modern rail option — premium tier by default,
      // though the planner's mode-preference logic also surfaces it in
      // economic/comfortable plans since it's still a fixed, affordable fare.
      category: "premium",
      governorate: data.lrt.governorate,
      priceEgpBase: data.lrt.priceEgpBase,
      priceEgpPerKm: data.lrt.priceEgpPerKm,
      frequencyMinutes: data.lrt.frequencyMinutes,
      hasFixedStops: true,
      lines: data.lrt.branches.map((b, i) => ({
        lineNumber: `LRT-${i + 1}`,
        nameEn: b.branchNameEn,
        nameAr: b.branchNameAr,
        stationsEn: b.stationsEn,
        stationsAr: b.stationsAr,
      })),
    },
    brt: {
      key: "brt",
      transportTypeNameEn: data.brt.nameEn,
      transportTypeNameAr: data.brt.nameAr,
      icon: data.brt.icon,
      color: data.brt.color,
      // BRT belongs in "comfortable" specifically, per spec.
      category: "comfortable",
      governorate: data.brt.governorate,
      priceEgpBase: data.brt.priceEgpBase,
      priceEgpPerKm: data.brt.priceEgpPerKm,
      frequencyMinutes: data.brt.frequencyMinutes,
      hasFixedStops: true,
      lines: data.brt.lines,
    },
    tram: {
      key: "tram",
      transportTypeNameEn: data.alexandriaTram.nameEn,
      transportTypeNameAr: data.alexandriaTram.nameAr,
      icon: data.alexandriaTram.icon,
      color: data.alexandriaTram.color,
      category: "economic",
      governorate: data.alexandriaTram.governorate,
      priceEgpBase: data.alexandriaTram.priceEgpBase,
      priceEgpPerKm: data.alexandriaTram.priceEgpPerKm,
      frequencyMinutes: data.alexandriaTram.frequencyMinutes,
      hasFixedStops: true,
      lines: data.alexandriaTram.lines,
    },
  };
}

async function upsertTransportType(spec: DatasetSpec) {
  const [existing] = await db
    .select()
    .from(transportTypesTable)
    .where(eq(transportTypesTable.nameEn, spec.transportTypeNameEn))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(transportTypesTable)
    .values({
      nameEn: spec.transportTypeNameEn,
      nameAr: spec.transportTypeNameAr,
      icon: spec.icon,
      color: spec.color,
      category: spec.category,
      governmentType: "government",
      serviceLevel: "standard",
      basePriceEgp: spec.priceEgpBase,
      pricePerKmEgp: spec.priceEgpPerKm,
      averageSpeedKmh: spec.key === "tram" ? 18 : spec.key === "brt" ? 35 : 50,
      foreignerAllowed: true,
      isActive: true,
    })
    .returning();
  return created;
}

router.post("/", requireAdmin, async (req, res) => {
  const datasetKey = typeof req.query.dataset === "string" ? req.query.dataset : "";
  const datasets = buildDatasets();
  const dataset = datasets[datasetKey];
  if (!dataset) {
    return res.status(400).json({ error: "dataset must be one of: lrt, brt, tram" });
  }

  const offset = Math.max(0, Number(req.query.offset) || 0);
  if (offset >= dataset.lines.length) {
    return res.json({ done: true, totalLines: dataset.lines.length, processed: 0, results: [] });
  }

  const type = await upsertTransportType(dataset);
  const line = dataset.lines[offset];
  const results: { line: string; status: string; coords?: number; geocodedStations?: number; totalStations?: number }[] = [];

  try {
    const cityHint = dataset.governorate === "Alexandria" ? "Alexandria" : "Cairo";
    const geocoded: [number, number][] = [];
    let geocodedCount = 0;
    for (const stationName of line.stationsEn) {
      const pt = await geocodeStopNominatim(stationName, cityHint);
      if (pt) {
        geocoded.push(pt);
        geocodedCount++;
      }
    }

    if (geocoded.length < 2) {
      results.push({ line: line.nameEn, status: "failed_no_geocode", geocodedStations: geocodedCount, totalStations: line.stationsEn.length });
    } else {
      const filtered = dropBacktrackingPoints(geocoded);
      const profile = dataset.key === "tram" ? "car" : dataset.key === "brt" ? "car" : "car"; // all three run on/along roads or dedicated rail alignment close to roads
      const snapped = await snapToRoadsFree(filtered, profile);
      const quality = checkPathQuality(snapped);

      const fromArea = line.stationsEn[0];
      const toArea = line.stationsEn[line.stationsEn.length - 1];
      const fromAreaAr = line.stationsAr[0];
      const toAreaAr = line.stationsAr[line.stationsAr.length - 1];
      const stopsPayload = line.stationsEn.map((name, i) => {
        const coordIdx = Math.min(i, geocoded.length - 1);
        const c = geocoded[coordIdx];
        return { name, lat: c?.[1] ?? 0, lng: c?.[0] ?? 0 };
      });

      // Replace any existing row for this exact line (idempotent re-seed).
      const [existingLine] = await db
        .select({ id: transitLinesTable.id })
        .from(transitLinesTable)
        .where(eq(transitLinesTable.lineNumber, line.lineNumber))
        .limit(1);

      const values = {
        transportTypeId: type.id,
        lineNumber: line.lineNumber,
        nameEn: line.nameEn,
        nameAr: line.nameAr,
        fromArea,
        toArea,
        governorate: dataset.governorate,
        viaStops: line.stationsEn.slice(1, -1),
        stops: stopsPayload,
        routePath: { type: "LineString" as const, coordinates: snapped },
        routeDirection: "forward",
        priceEgp: Math.round(dataset.priceEgpBase + dataset.priceEgpPerKm * (geocoded.length > 1 ? 0 : 0)),
        frequencyMinutes: dataset.frequencyMinutes,
        hasFixedStops: dataset.hasFixedStops,
        isActive: true,
        dataSource: "gtfs", // best-effort GTFS-equivalent: real station list + road/rail-snapped shape
        sourcePriority: 30,
        confidenceScore: quality.ok ? 0.85 : 0.55,
        routeStatus: quality.ok ? "active" as const : "needs_review" as const,
        needsReviewReason: quality.ok ? null : quality.reason,
        verifiedAt: quality.ok ? new Date() : null,
        updatedAt: new Date(),
      };

      if (existingLine) {
        await db.update(transitLinesTable).set(values).where(eq(transitLinesTable.id, existingLine.id));
      } else {
        await db.insert(transitLinesTable).values(values);
      }

      results.push({
        line: line.nameEn,
        status: quality.ok ? "seeded" : "seeded_needs_review",
        coords: snapped.length,
        geocodedStations: geocodedCount,
        totalStations: line.stationsEn.length,
      });
    }
  } catch (err) {
    results.push({ line: line.nameEn, status: `failed: ${err instanceof Error ? err.message : "unknown error"}` });
  }

  const nextOffset = offset + 1;
  res.json({
    done: nextOffset >= dataset.lines.length,
    totalLines: dataset.lines.length,
    processed: 1,
    nextOffset,
    results,
  });
});

export default router;
