import { Router } from "express";
import { runIntercitySearch, EGYPT_CITIES, getSuperJetCities } from "../lib/intercitySearch.js";
import { db } from "@workspace/db";
import { interTripsCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const OPERATORS = [
  {
    id: "superjet",
    name: "SuperJet",
    slug: "superjet",
    logoUrl: null,
    website: "https://www.superjet.com.eg",
    bookingType: "online",
    active: true,
  },
  {
    id: "gobus",
    name: "GoBus",
    slug: "gobus",
    logoUrl: null,
    website: "https://www.go-bus.com",
    bookingType: "online",
    active: true,
  },
  {
    id: "bluebus",
    name: "BlueBus",
    slug: "bluebus",
    logoUrl: null,
    website: "https://www.bluebus.com.eg",
    bookingType: "online",
    active: true,
  },
];

// GET /api/intercity/operators
router.get("/operators", (_req, res) => {
  res.json(OPERATORS);
});

// GET /api/intercity/cities
router.get("/cities", (_req, res) => {
  const cities = EGYPT_CITIES.map((c) => ({
    id: c.id,
    nameEn: c.nameEn,
    nameAr: c.nameAr,
    normalizedName: c.normalizedName,
    governorate: c.governorate,
    lat: c.lat ?? null,
    lng: c.lng ?? null,
  }));
  res.json(cities);
});

// GET /api/intercity/search?from=Cairo&to=Hurghada&date=2026-06-01&userLat=&userLng=
router.get("/search", async (req, res) => {
  const { from, to, date, userLat, userLng } = req.query as Record<string, string>;

  if (!from || !to || !date) {
    return res.status(400).json({ error: "from, to, and date are required" });
  }

  const cacheKey = `${from}|${to}|${date}`.toLowerCase();

  // Check cache (15-minute TTL)
  try {
    const cached = await db
      .select()
      .from(interTripsCacheTable)
      .where(eq(interTripsCacheTable.cacheKey, cacheKey))
      .limit(1);

    if (cached.length > 0 && new Date(cached[0].expiresAt) > new Date()) {
      return res.json({ ...JSON.parse(cached[0].data), cached: true });
    }
  } catch {
    // cache miss is fine
  }

  const lat = userLat ? parseFloat(userLat) : null;
  const lng = userLng ? parseFloat(userLng) : null;

  try {
    const result = await runIntercitySearch(from, to, date, lat, lng);

    // Store in cache
    try {
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await db
        .insert(interTripsCacheTable)
        .values({
          cacheKey,
          data: JSON.stringify({ ...result, cached: false }),
          expiresAt,
        })
        .onConflictDoUpdate({
          target: interTripsCacheTable.cacheKey,
          set: {
            data: JSON.stringify({ ...result, cached: false }),
            expiresAt,
          },
        });
    } catch {
      // cache write failure is non-fatal
    }

    return res.json({ ...result, cached: false });
  } catch (err) {
    console.error("Intercity search error:", err);
    return res.status(500).json({ error: "Search failed" });
  }
});

export default router;
