import { Router } from "express";
import { db } from "@workspace/db";
import { transportTypesTable, transitLinesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { EGYPT_CITIES } from "../lib/intercitySearch.js";
import { runIntercitySearch } from "../lib/intercitySearch.js";
import { planTripApi } from "../engine/planner.js";
import { snapConnector } from "../utils/routePathGenerator.js";

const router = Router();

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Cairo + Giza are one metro area — travel within them stays "city" mode.
const GREATER_CAIRO = new Set(["Cairo", "Giza"]);

function nearestCity(lat: number, lng: number) {
  let best: (typeof EGYPT_CITIES)[number] | null = null;
  let bestDist = Infinity;
  for (const c of EGYPT_CITIES) {
    if (c.lat == null || c.lng == null) continue;
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best ? { city: best, dist: bestDist } : null;
}

function zoneOf(governorate: string) {
  return GREATER_CAIRO.has(governorate) ? "greater_cairo" : governorate;
}

// Decide whether a trip crosses governorate zones (intercity).
function detectIntercity(startLat: number, startLng: number, endLat: number, endLng: number) {
  const distanceKm = haversineKm(startLat, startLng, endLat, endLng);
  const startNear = nearestCity(startLat, startLng);
  const endNear = nearestCity(endLat, endLng);
  const isIntercity =
    !!startNear && !!endNear &&
    distanceKm > 50 &&
    zoneOf(startNear.city.governorate) !== zoneOf(endNear.city.governorate);
  return { distanceKm, startNear, endNear, isIntercity };
}

// Does any serfis route plausibly reach the destination city? (matches city name in stops)
async function findSerfisToCity(toCity: IntercityCity) {
  const types = await db.select().from(transportTypesTable).where(eq(transportTypesTable.isActive, true));
  const serfisType = types.find((t) => t.nameEn.toLowerCase().includes("serfis"));
  if (!serfisType) return false;
  const lines = await db.select().from(transitLinesTable).where(eq(transitLinesTable.transportTypeId, serfisType.id));
  const targets = [toCity.nameAr, toCity.nameEn].map((s) => s.toLowerCase()).filter(Boolean);
  return lines.some((l) => {
    const hay = [l.fromArea, l.toArea, ...(l.viaStops ?? [])].filter(Boolean).map((s) => s.toLowerCase());
    return targets.some((tgt) => hay.some((h) => h.includes(tgt) || tgt.includes(h)));
  });
}

// GET /api/trips/plan/intercity-check?startLat&startLng&endLat&endLng
router.get("/intercity-check", async (req, res) => {
  const startLat = parseFloat(String(req.query.startLat));
  const startLng = parseFloat(String(req.query.startLng));
  const endLat = parseFloat(String(req.query.endLat));
  const endLng = parseFloat(String(req.query.endLng));
  if ([startLat, startLng, endLat, endLng].some((n) => Number.isNaN(n))) {
    return res.status(400).json({ error: "startLat, startLng, endLat, endLng are required" });
  }
  const { isIntercity, startNear, endNear } = detectIntercity(startLat, startLng, endLat, endLng);
  if (!isIntercity || !startNear || !endNear) {
    return res.json({ isIntercity: false, hasSerfis: false, fromCity: null, toCity: null });
  }
  let hasSerfis = false;
  try {
    hasSerfis = await findSerfisToCity(endNear.city);
  } catch (err) {
    console.error("Serfis check error:", err);
  }
  return res.json({
    isIntercity: true,
    hasSerfis,
    fromCity: { id: startNear.city.id, nameEn: startNear.city.nameEn, nameAr: startNear.city.nameAr },
    toCity: { id: endNear.city.id, nameEn: endNear.city.nameEn, nameAr: endNear.city.nameAr },
  });
});

router.post("/", requireAuth, async (req, res) => {
  const { startLat, startLng, endLat, endLng, tripType, language, mode } = req.body;

  const distanceKm = haversineKm(startLat, startLng, endLat, endLng);
  const isArabicLang = language === "ar";

  // ── Intercity auto-mode: destination in a different governorate / far away ──
  // Skipped when the client explicitly forces city mode (e.g. user chose Serfis).
  const startNear = nearestCity(startLat, startLng);
  const endNear = nearestCity(endLat, endLng);
  if (
    mode !== "city" &&
    startNear && endNear &&
    distanceKm > 50 &&
    zoneOf(startNear.city.governorate) !== zoneOf(endNear.city.governorate)
  ) {
    try {
      const intercityPlan = await buildIntercityPlan(
        startNear.city, endNear.city, distanceKm, isArabicLang,
      );
      if (intercityPlan) return res.json(intercityPlan);
    } catch (err) {
      console.error("Intercity plan error:", err);
      // fall through to normal city planning
    }
  }

  const isArabic = language === "ar";
  const planKey: "economic" | "comfortable" | "premium" =
    tripType === "economic" || tripType === "premium" ? tripType : "comfortable";

  // Rough taxi estimate kept solely for the safety-net fallback below.
  const taxiEst = Math.round(15 + distanceKm * 4);

  try {
    // Deterministic graph engine — NO AI, NEVER invents routes. It searches a
    // graph built only from verified DB data (lines, stops, paths, fares).
    const plan = await planTripApi({
      origin: { lat: startLat, lng: startLng },
      dest: { lat: endLat, lng: endLng },
      planKey,
      isArabic,
      language,
    });
    if (plan && plan.segments.length > 0) return res.json(plan);
    // Engine produced nothing verifiable. Door-to-door taxi-app travel is allowed only
    // for premium; non-premium users should not receive a full-trip taxi plan.
    if (planKey === "premium") return res.json(await generateFallbackPlan(startLat, startLng, endLat, endLng, distanceKm, taxiEst, isArabic));
    return res.status(409).json({ error: isArabic ? "لا يوجد مسار مواصلات موثّق بدون تطبيق تاكسي للرحلة كلها. جرّب الخطة المميزة أو غيّر نقطة البداية/النهاية." : "No verified non-premium transit route was found without taking a taxi app for the whole trip. Try Premium or adjust the start/end point." });
  } catch (err: unknown) {
    console.error("Engine trip plan error:", err);
    if (planKey === "premium") return res.json(await generateFallbackPlan(startLat, startLng, endLat, endLng, distanceKm, taxiEst, isArabic));
    return res.status(409).json({ error: isArabic ? "تعذر إنشاء مسار موثّق بدون جعل تطبيق تاكسي الرحلة كلها." : "Could not build a verified route without making a taxi app the whole trip." });
  }
});

type IntercityCity = (typeof EGYPT_CITIES)[number];

async function buildIntercityPlan(
  fromCity: IntercityCity,
  toCity: IntercityCity,
  distanceKm: number,
  isArabic: boolean,
) {
  const tr = (en: string, ar: string) => (isArabic ? ar : en);
  const fromName = isArabic ? fromCity.nameAr : fromCity.nameEn;
  const toName = isArabic ? toCity.nameAr : toCity.nameEn;

  const date = new Date().toISOString().slice(0, 10);
  let trips: Awaited<ReturnType<typeof runIntercitySearch>>["trips"] = [];
  try {
    const result = await runIntercitySearch(fromCity.nameEn, toCity.nameEn, date);
    trips = result.trips;
  } catch (err) {
    console.error("Intercity search failed inside plan:", err);
  }

  // Cheapest trip becomes the primary segment; others become alternatives.
  trips = [...trips].sort((a, b) => a.priceEgp - b.priceEgp);
  const primary = trips[0];

  const estPrice = primary?.priceEgp ?? Math.round(80 + distanceKm * 0.9);
  const estDuration = primary?.durationMinutes ?? Math.round((distanceKm / 80) * 60);

  const operatorName = primary?.operator ?? tr("Intercity Bus", "أتوبيس السفر");

  const instructions = primary
    ? [
        tr(
          `Go to ${primary.fromStation || fromName} station.`,
          `اذهب إلى محطة ${primary.fromStation || fromName}.`,
        ),
        tr(
          `Take the ${primary.operator} bus departing at ${primary.departure}.`,
          `اركب أتوبيس ${primary.operator} المغادر الساعة ${primary.departure}.`,
        ),
        tr(
          primary.bookingUrl
            ? `Book online or at the office (~${estPrice} EGP).`
            : `Buy your ticket at the station office (~${estPrice} EGP).`,
          primary.bookingUrl
            ? `احجز أونلاين أو من المكتب (~${estPrice} جنيه).`
            : `اشترِ تذكرتك من مكتب المحطة (~${estPrice} جنيه).`,
        ),
        tr(
          `Arrive in ${toName}${primary.arrival ? ` around ${primary.arrival}` : ""}.`,
          `تصل إلى ${toName}${primary.arrival ? ` حوالي ${primary.arrival}` : ""}.`,
        ),
      ]
    : [
        tr(`Head to the intercity bus terminal in ${fromName}.`, `توجه إلى موقف أتوبيس السفر في ${fromName}.`),
        tr(`Take an intercity bus toward ${toName}.`, `اركب أتوبيس سفر متجه إلى ${toName}.`),
        tr(`Pay at the station (~${estPrice} EGP).`, `ادفع في المحطة (~${estPrice} جنيه).`),
      ];

  const alternatives = trips.slice(1, 4).map((t) => ({
    transport_type_id: "intercity",
    transport_name: `${t.operator} — ${t.departure}`,
    cost_egp: t.priceEgp,
    duration_minutes: t.durationMinutes,
    color: "#0EA5E9",
    icon: "bus",
  }));

  const segment = {
    transport_type_id: "intercity",
    transport_name: `${operatorName} — ${fromName} → ${toName}`,
    government_type: "private",
    category: "comfortable",
    start_name: primary?.fromStation || fromName,
    end_name: primary?.toStation || toName,
    cost_egp: estPrice,
    duration_minutes: estDuration,
    color: "#0EA5E9",
    icon: "bus",
    line_id: null,
    line_number: null,
    info: tr(
      `Intercity trip from ${fromName} to ${toName} (~${Math.round(distanceKm)} km).`,
      `رحلة سفر من ${fromName} إلى ${toName} (~${Math.round(distanceKm)} كم).`,
    ),
    instructions,
    route_geometry: null,
    booking_url: primary?.bookingUrl ?? null,
    alternatives,
  };

  return {
    segments: [segment],
    total_cost_egp: estPrice,
    total_duration_minutes: estDuration,
    budget_range: { min: Math.round(estPrice * 0.8), max: Math.round(estPrice * 1.4) },
    distance_km: parseFloat(distanceKm.toFixed(1)),
    intercity: true,
    from_city: fromName,
    to_city: toName,
  };
}

// Last-resort fallback used ONLY when the deterministic graph engine cannot run
// at all (e.g. it threw). It NEVER invents a transit route: a door-to-door
// Taxi app ride is a real, computable option (origin → dest at a metered
// fare), not a fabricated metro/bus/serfis line with imaginary stations.
async function generateFallbackPlan(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  distanceKm: number,
  taxiEst: number,
  isArabic: boolean,
) {
  const tr = (en: string, ar: string) => (isArabic ? ar : en);
  const duration = Math.max(5, Math.round(distanceKm * 2.5));
  const routeGeometry = await snapConnector("driving", [startLng, startLat], [endLng, endLat]) ?? [
    [startLng, startLat] as [number, number],
    [endLng, endLat] as [number, number],
  ];
  const segment = {
    transport_type_id: "car",
    transport_name: tr("Taxi app", "تطبيق تاكسي"),
    government_type: "private",
    category: "premium",
    start_name: tr("Your Location", "موقعك"),
    end_name: tr("Destination", "الوجهة"),
    cost_egp: taxiEst,
    duration_minutes: duration,
    color: "#06B6D4",
    icon: "car",
    line_id: null,
    line_number: "",
    info: tr("Door-to-door ride.", "رحلة من الباب للباب."),
    instructions: [
      tr("Open a taxi app.", "افتح تطبيق تاكسي."),
      tr("Enter your destination and confirm pickup at your location.", "أدخل وجهتك وأكد مكان الالتقاء عند موقعك."),
      tr(`Pay in-app or cash (~${taxiEst} EGP).`, `ادفع عبر التطبيق أو نقدًا (~${taxiEst} جنيه).`),
    ],
    route_geometry: routeGeometry,
    alternatives: [],
  };
  return {
    segments: [segment],
    total_cost_egp: taxiEst,
    total_duration_minutes: duration,
    budget_range: { min: Math.round(taxiEst * 0.8), max: Math.round(taxiEst * 1.3) },
    distance_km: parseFloat(distanceKm.toFixed(1)),
    engine: "taxi-fallback",
  };
}

export default router;
