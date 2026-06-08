/**
 * GTFS import — authoritative Transport-for-Cairo (GCR Digital Cairo 2017) feed.
 *
 * Source data is vendored at src/data/gtfsCairo.json (extracted from the
 * 20180906_GTFSfullworking_Bus_Metro feed: 3 metro lines + 214 bus/paratransit
 * routes, each with real shape geometry).
 *
 * Agency → existing transport type mapping (all types already seeded):
 *   NAT                    → Metro      (full replace)
 *   CTA                    → NTA Bus
 *   CTA_M, COOP            → Serfis
 *   P_O_14, P_B_8, BOX     → Microbus
 *
 * Rules honoured:
 *   - Metro: GTFS fully covers it → delete existing Metro lines, insert 3 GTFS lines.
 *   - Bus/Serfis/Microbus: insert GTFS routes; KEEP every existing line that GTFS
 *     does NOT cover. When a GTFS route matches an existing same-type line by
 *     endpoint proximity, merge them into one line that carries BOTH route numbers
 *     ("<gtfs#> or <old#>") and prefers the authoritative GTFS geometry.
 *   - CTA Bus type (Alexandria) and all other types are left untouched.
 *
 * POST /api/admin/seed-gtfs            — apply the import
 * POST /api/admin/seed-gtfs?dryRun=true — report what would change, write nothing
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { transportTypesTable, transitLinesTable, locationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import gtfsData from "../data/gtfsCairo.json";

const router = Router();

interface GtfsRoute {
  routeId: string;
  agency: string;
  shortName: string;
  longName: string;
  desc: string;
  routeType: number;
  color?: string;
  coords: [number, number][];
  stations?: { name: string; lat: number; lng: number }[];
}

const FEED = gtfsData as unknown as { source: string; generatedAt: string; routes: GtfsRoute[] };

// agency → { type name, price, freq } for bus-like agencies
const BUS_AGENCY: Record<string, { type: string; price: number; freq: number }> = {
  CTA: { type: "NTA Bus", price: 19, freq: 20 },
  CTA_M: { type: "Serfis", price: 5, freq: 20 },
  COOP: { type: "Serfis", price: 5, freq: 20 },
  P_O_14: { type: "Microbus", price: 3, freq: 15 },
  P_B_8: { type: "Microbus", price: 3, freq: 15 },
  BOX: { type: "Microbus", price: 3, freq: 15 },
};

const MATCH_KM = 1.5; // both endpoints within this distance ⇒ same route

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function splitName(longName: string): { from: string; to: string } {
  const i = longName.indexOf("-");
  if (i === -1) return { from: longName.trim(), to: longName.trim() };
  return { from: longName.slice(0, i).trim(), to: longName.slice(i + 1).trim() };
}

function endpoints(coords: [number, number][]): { a: [number, number]; b: [number, number] } {
  return { a: coords[0], b: coords[coords.length - 1] };
}

// existing line ↔ gtfs line endpoint closeness (either orientation).
// Returns the worse of the two paired endpoint distances for the best
// orientation, or Infinity when neither orientation is within MATCH_KM.
// Used to pick the *nearest* candidate, not merely the first that matches.
function endpointScore(
  gtfs: [number, number][],
  existing: [number, number][],
): number {
  if (existing.length < 2 || gtfs.length < 2) return Infinity;
  const g = endpoints(gtfs);
  const e = endpoints(existing);
  const same = Math.max(haversineKm(g.a, e.a), haversineKm(g.b, e.b));
  const flip = Math.max(haversineKm(g.a, e.b), haversineKm(g.b, e.a));
  const best = Math.min(same, flip);
  return best <= MATCH_KM ? best : Infinity;
}

async function getTypeId(nameEn: string): Promise<string | null> {
  const [t] = await db
    .select({ id: transportTypesTable.id })
    .from(transportTypesTable)
    .where(eq(transportTypesTable.nameEn, nameEn))
    .limit(1);
  return t?.id ?? null;
}

export async function runGtfsImport(dryRun: boolean) {
  // ─── resolve type ids ────────────────────────────────────────────────
  const metroId = await getTypeId("Metro");
  if (!metroId) {
    throw new Error("Metro transport type not found — run seed-cairo first");
  }
  const busTypeIds: Record<string, string> = {};
  for (const name of ["NTA Bus", "Serfis", "Microbus"]) {
    const id = await getTypeId(name);
    if (!id) {
      throw new Error(`Transport type '${name}' not found — run seed-cairo first`);
    }
    busTypeIds[name] = id;
  }

  const summary = {
      source: FEED.source,
      dryRun,
      metro: { deleted: 0, inserted: 0, stationsUpserted: 0 },
      buses: { inserted: 0, merged: 0, keptExisting: 0 } as Record<string, number>,
      mergedExamples: [] as string[],
    };

    const metroRoutes = FEED.routes.filter((r) => r.agency === "NAT");
    const busRoutes = FEED.routes.filter((r) => r.agency !== "NAT");

    // All writes run in one transaction so a mid-run failure can never leave a
    // half-replaced Metro or a partially imported bus set. NOTE: the callback
    // param is deliberately named `db` to shadow the module import, so every
    // write below executes against the transaction handle unchanged.
    await db.transaction(async (db) => {
    // ─── METRO: full replace ─────────────────────────────────────────────
    const existingMetro = await db
      .select({ id: transitLinesTable.id })
      .from(transitLinesTable)
      .where(eq(transitLinesTable.transportTypeId, metroId));
    summary.metro.deleted = existingMetro.length;

    if (!dryRun) {
      await db.delete(transitLinesTable).where(eq(transitLinesTable.transportTypeId, metroId));
    }

    // upsert station locations
    const existingStations = await db
      .select({ nameEn: locationsTable.nameEn })
      .from(locationsTable);
    const stationNames = new Set(existingStations.map((s) => s.nameEn.toLowerCase()));

    for (const m of metroRoutes) {
      const stations = m.stations ?? [];
      const from = stations[0]?.name ?? m.desc.split("-")[0].trim();
      const to = stations[stations.length - 1]?.name ?? m.desc.split("-").pop()!.trim();
      if (!dryRun) {
        await db.insert(transitLinesTable).values({
          transportTypeId: metroId,
          lineNumber: m.shortName,
          nameEn: `${m.shortName}: ${from} → ${to}`,
          nameAr: `مترو ${m.shortName}: ${from} - ${to}`,
          fromArea: from,
          toArea: to,
          governorate: "Cairo",
          viaStops: stations.slice(1, -1).map((s) => s.name),
          stops: stations,
          routePath: { type: "LineString", coordinates: m.coords },
          priceEgp: 10,
          frequencyMinutes: 5,
          hasFixedStops: true,
          isActive: true,
        });
        for (const st of stations) {
          if (stationNames.has(st.name.toLowerCase())) continue;
          stationNames.add(st.name.toLowerCase());
          await db.insert(locationsTable).values({
            nameEn: st.name,
            nameAr: st.name,
            latitude: st.lat,
            longitude: st.lng,
            city: "cairo",
            isStation: true,
          });
          summary.metro.stationsUpserted++;
        }
      } else {
        summary.metro.stationsUpserted += stations.filter(
          (s) => !stationNames.has(s.name.toLowerCase()),
        ).length;
      }
      summary.metro.inserted++;
    }

    // ─── BUSES: insert + endpoint merge, keep unmatched existing ──────────
    // Load existing lines for the three target types (with route_path for matching).
    const existingByType: Record<
      string,
      { id: string; lineNumber: string | null; coords: [number, number][] }[]
    > = {};
    for (const name of ["NTA Bus", "Serfis", "Microbus"]) {
      const rows = await db
        .select({
          id: transitLinesTable.id,
          lineNumber: transitLinesTable.lineNumber,
          routePath: transitLinesTable.routePath,
        })
        .from(transitLinesTable)
        .where(eq(transitLinesTable.transportTypeId, busTypeIds[name]));
      existingByType[name] = rows.map((r) => ({
        id: r.id,
        lineNumber: r.lineNumber,
        coords: (r.routePath?.coordinates ?? []) as [number, number][],
      }));
    }

    const consumed = new Set<string>(); // existing line ids already merged

    for (const b of busRoutes) {
      const map = BUS_AGENCY[b.agency];
      if (!map) continue;
      const typeId = busTypeIds[map.type];
      const { from, to } = splitName(b.longName);

      // find best matching existing line of the same type
      const candidates = existingByType[map.type] ?? [];
      let match: (typeof candidates)[number] | undefined;
      let bestScore = Infinity;
      for (const c of candidates) {
        if (consumed.has(c.id)) continue;
        const score = endpointScore(b.coords, c.coords);
        if (score < bestScore) {
          bestScore = score;
          match = c;
        }
      }

      if (match) {
        consumed.add(match.id);
        const oldNum = match.lineNumber?.trim();
        const dualNum = oldNum && oldNum !== b.shortName ? `${b.shortName} or ${oldNum}` : b.shortName;
        if (!dryRun) {
          await db
            .update(transitLinesTable)
            .set({
              lineNumber: dualNum,
              nameEn: `${dualNum}: ${from} → ${to}`,
              nameAr: `${dualNum}: ${from} - ${to}`,
              fromArea: from,
              toArea: to,
              viaStops: b.stations?.length ? b.stations.slice(1, -1).map((s) => s.name) : [],
              stops: b.stations ?? [],
              routePath: { type: "LineString", coordinates: b.coords },
              priceEgp: map.price,
              frequencyMinutes: map.freq,
              hasFixedStops: false,
              isActive: true,
              updatedAt: new Date(),
            })
            .where(eq(transitLinesTable.id, match.id));
        }
        summary.buses.merged++;
        if (summary.mergedExamples.length < 20) {
          summary.mergedExamples.push(`${map.type}: ${dualNum} (${from} → ${to})`);
        }
      } else {
        if (!dryRun) {
          await db.insert(transitLinesTable).values({
            transportTypeId: typeId,
            lineNumber: b.shortName,
            nameEn: `${b.shortName}: ${from} → ${to}`,
            nameAr: `${b.shortName}: ${from} - ${to}`,
            fromArea: from,
            toArea: to,
            governorate: "Cairo",
            viaStops: b.stations?.length ? b.stations.slice(1, -1).map((s) => s.name) : [],
            stops: b.stations ?? [],
            routePath: { type: "LineString", coordinates: b.coords },
            priceEgp: map.price,
            frequencyMinutes: map.freq,
            hasFixedStops: false,
            isActive: true,
          });
        }
        summary.buses.inserted++;
      }
    }

    // count existing lines left intact across the three bus types
    summary.buses.keptExisting = Object.values(existingByType).reduce(
      (acc, rows) => acc + rows.filter((r) => !consumed.has(r.id)).length,
      0,
    );
    });

  return summary;
}

router.post("/", requireAdmin, async (req, res) => {
  const dryRun = req.query.dryRun === "true";
  try {
    const summary = await runGtfsImport(dryRun);
    res.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[seed-gtfs] failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
