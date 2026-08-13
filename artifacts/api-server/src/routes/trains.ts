/**
 * Intercity train schedule search — same shape of feature as /intercity
 * (bus/flight/taxi between cities), but for Egyptian National Railways
 * trains: search by city pair or train number, see the full stop-by-stop
 * timetable with terminals and clock times.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { trainsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { EGYPT_CITIES } from "../lib/intercityTypes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

router.get("/cities", async (_req, res) => {
  const rows = await db.select({ fromCity: trainsTable.fromCity, toCity: trainsTable.toCity }).from(trainsTable).where(eq(trainsTable.isActive, true));
  const cities = new Set<string>();
  for (const r of rows) {
    cities.add(r.fromCity);
    cities.add(r.toCity);
  }
  res.json([...cities].sort());
});

// GET /api/trains/governorates — unlike /api/intercity/governorates (which
// lists every governorate Egypt's intercity buses reasonably reach),
// Egypt's rail network genuinely doesn't go everywhere -- there is, for
// example, no line into South Sinai at all. This resolves the governorates
// actually reachable from the real seeded timetables (every fromCity/toCity
// and every named stop) so the train picker only ever offers a destination
// a train can really take you to, per each train's own stop order.
router.get("/governorates", async (_req, res) => {
  const rows = await db
    .select({ fromCity: trainsTable.fromCity, toCity: trainsTable.toCity, stops: trainsTable.stops })
    .from(trainsTable)
    .where(eq(trainsTable.isActive, true));

  const rawNames = new Set<string>();
  for (const r of rows) {
    rawNames.add(r.fromCity);
    rawNames.add(r.toCity);
    for (const s of r.stops as { name: string }[]) rawNames.add(s.name);
  }

  // Station names sometimes carry a terminal suffix (e.g. "Alexandria (Sidi
  // Gaber)") that a plain EGYPT_CITIES lookup won't match verbatim -- strip
  // any "(...)" qualifier before resolving to a known city/governorate.
  const stripQualifier = (name: string) => name.replace(/\s*\([^)]*\)\s*/g, "").trim();
  const norm = (s: string) => s.toLowerCase().trim();

  const matchedByGovernorate = new Map<string, (typeof EGYPT_CITIES)[number]>();
  for (const raw of rawNames) {
    const bare = stripQualifier(raw);
    const city = EGYPT_CITIES.find((c) => norm(c.nameEn) === norm(bare))
      ?? EGYPT_CITIES.find((c) => norm(c.nameEn).includes(norm(bare)) || norm(bare).includes(norm(c.nameEn)));
    if (city && !matchedByGovernorate.has(city.governorate)) {
      matchedByGovernorate.set(city.governorate, city);
    }
  }

  const governorates = Array.from(matchedByGovernorate.entries())
    .map(([governorate, hubCity]) => ({
      governorate,
      nameEn: hubCity.nameEn,
      nameAr: hubCity.nameAr,
      hubCityId: hubCity.id,
      hubCityNameEn: hubCity.nameEn,
      hubCityNameAr: hubCity.nameAr,
    }))
    .sort((a, b) => a.nameEn.localeCompare(b.nameEn));

  res.json(governorates);
});

router.get("/search", async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from.trim() : "";
  const to = typeof req.query.to === "string" ? req.query.to.trim() : "";
  if (!from && !to) {
    const all = await db.select().from(trainsTable).where(eq(trainsTable.isActive, true)).orderBy(asc(trainsTable.trainNumber));
    return res.json(all);
  }

  // Matches a train whose stop list includes both cities, in either role
  // (from→to or any pair of named stops along the route) — a train running
  // Cairo→Aswan also legitimately serves a Cairo→Luxor rider, since Luxor is
  // one of its stops.
  const all = await db.select().from(trainsTable).where(eq(trainsTable.isActive, true));
  const matches = all.filter((t) => {
    const stopNames = t.stops.map((s) => s.name.toLowerCase());
    const fromOk = !from || stopNames.some((n) => n.includes(from.toLowerCase())) || t.fromCity.toLowerCase().includes(from.toLowerCase());
    const toOk = !to || stopNames.some((n) => n.includes(to.toLowerCase())) || t.toCity.toLowerCase().includes(to.toLowerCase());
    if (!fromOk || !toOk) return false;
    if (from && to) {
      // Ensure the "from" stop genuinely comes before the "to" stop on this train.
      const fromIdx = stopNames.findIndex((n) => n.includes(from.toLowerCase()));
      const toIdx = stopNames.findIndex((n) => n.includes(to.toLowerCase()));
      if (fromIdx === -1 || toIdx === -1) return true; // matched on fromCity/toCity instead of a stop name
      return fromIdx < toIdx;
    }
    return true;
  });
  res.json(matches);
});

router.get("/:trainNumber", async (req, res) => {
  const [row] = await db.select().from(trainsTable).where(eq(trainsTable.trainNumber, req.params.trainNumber)).limit(1);
  if (!row) return res.status(404).json({ error: "train not found" });
  res.json(row);
});

router.post("/", requireAdmin, async (req, res) => {
  const { trainNumber, trainType, fromCity, toCity, stops, operatingNote, operatingNoteAr } = req.body;
  if (!trainNumber || !fromCity || !toCity || !Array.isArray(stops) || stops.length < 2) {
    return res.status(400).json({ error: "trainNumber, fromCity, toCity, and at least 2 stops are required" });
  }
  const [row] = await db.insert(trainsTable).values({
    trainNumber: String(trainNumber),
    trainType: trainType || "Russian",
    fromCity, toCity, stops,
    operatingNote: operatingNote ?? null,
    operatingNoteAr: operatingNoteAr ?? null,
    lastUpdated: new Date().toISOString().slice(0, 10),
  }).returning();
  res.json(row);
});

router.put("/:id", requireAdmin, async (req, res) => {
  const allowed = ["trainNumber", "trainType", "fromCity", "toCity", "stops", "operatingNote", "operatingNoteAr", "isActive"] as const;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  const [row] = await db.update(trainsTable).set(updates).where(eq(trainsTable.id, req.params.id)).returning();
  if (!row) return res.status(404).json({ error: "train not found" });
  res.json(row);
});

router.delete("/:id", requireAdmin, async (req, res) => {
  await db.delete(trainsTable).where(eq(trainsTable.id, req.params.id));
  res.json({ success: true });
});

/**
 * Seeds the vendored real-data timetables (two fully-detailed trains plus
 * route-level summaries for the other major lines) from
 * src/data/egyptTrainsSeed.json. Idempotent — re-running updates existing
 * rows by train number rather than duplicating them.
 */
router.post("/seed", requireAdmin, async (_req, res) => {
  const seedData = JSON.parse(
    readFileSync(path.join(__dirname, "../data/egyptTrainsSeed.json"), "utf-8"),
  ) as {
    detailedTrains: { trainNumber: string; trainType: string; fromCity: string; toCity: string; operatingNote: string; operatingNoteAr: string; stops: { name: string; nameAr?: string; arrival?: string; departure?: string }[] }[];
    routeSummaries: { fromCity: string; toCity: string; approxStops: number; approxDurationMinutes: number; trainType: string; operatingNote: string }[];
  };

  const results: { trainNumber: string; status: string }[] = [];

  for (const t of seedData.detailedTrains) {
    const [existing] = await db.select({ id: trainsTable.id }).from(trainsTable).where(eq(trainsTable.trainNumber, t.trainNumber)).limit(1);
    const values = {
      trainNumber: t.trainNumber, trainType: t.trainType, fromCity: t.fromCity, toCity: t.toCity,
      stops: t.stops, operatingNote: t.operatingNote, operatingNoteAr: t.operatingNoteAr,
      lastUpdated: new Date().toISOString().slice(0, 10), updatedAt: new Date(),
    };
    if (existing) {
      await db.update(trainsTable).set(values).where(eq(trainsTable.id, existing.id));
    } else {
      await db.insert(trainsTable).values(values);
    }
    results.push({ trainNumber: t.trainNumber, status: existing ? "updated" : "seeded" });
  }

  // Route summaries don't have a real train number — synthesize a stable
  // placeholder ("SUM-Cairo-Aswan") so re-running this seed stays idempotent,
  // and clearly mark them as approximate (no per-stop clock times yet) via
  // the operating note, rather than fabricating exact times we don't have.
  for (const r of seedData.routeSummaries) {
    const placeholderNumber = `SUM-${r.fromCity}-${r.toCity}`;
    const approxNote = `${r.operatingNote} — approximate, ~${r.approxStops} stops, ~${Math.round(r.approxDurationMinutes / 60)}h journey. Exact stop times not yet confirmed.`;
    const [existing] = await db.select({ id: trainsTable.id }).from(trainsTable).where(eq(trainsTable.trainNumber, placeholderNumber)).limit(1);
    const values = {
      trainNumber: placeholderNumber, trainType: r.trainType, fromCity: r.fromCity, toCity: r.toCity,
      stops: [
        { name: r.fromCity },
        { name: r.toCity },
      ],
      operatingNote: approxNote, operatingNoteAr: null,
      lastUpdated: new Date().toISOString().slice(0, 10), updatedAt: new Date(),
    };
    if (existing) {
      await db.update(trainsTable).set(values).where(eq(trainsTable.id, existing.id));
    } else {
      await db.insert(trainsTable).values(values);
    }
    results.push({ trainNumber: placeholderNumber, status: existing ? "updated" : "seeded" });
  }

  res.json({ done: true, count: results.length, results });
});

export default router;
