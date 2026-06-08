import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { planTripApi } from "../engine/planner.js";
import { snapConnector } from "../utils/routePathGenerator.js";

const router = Router();
const PLANNER_TIMEOUT_MS = 14_000;

type PlanKey = "economic" | "comfortable" | "premium";

function asNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function planKeyFrom(value: unknown): PlanKey {
  return value === "economic" || value === "premium" ? value : "comfortable";
}

function tr(isArabic: boolean, en: string, ar: string) {
  return isArabic ? ar : en;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Trip planner timed out")), ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function fallbackPlan(args: {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  distanceKm: number;
  planKey: PlanKey;
  isArabic: boolean;
  reason: string;
}) {
  const { startLat, startLng, endLat, endLng, distanceKm, planKey, isArabic, reason } = args;
  const taxiEstimate = Math.max(25, Math.round(15 + distanceKm * 4.5));
  const duration = Math.max(5, Math.round(distanceKm * 2.5));
  const routeGeometry =
    (await snapConnector("driving", [startLng, startLat], [endLng, endLat])) ??
    [
      [startLng, startLat] as [number, number],
      [endLng, endLat] as [number, number],
    ];

  const segment = {
    transport_type_id: "taxi_app",
    transport_name: tr(isArabic, "Taxi app", "تطبيق تاكسي"),
    government_type: "private",
    category: planKey === "premium" ? "premium" : "comfortable",
    start_name: tr(isArabic, "Your location", "موقعك"),
    end_name: tr(isArabic, "Destination", "الوجهة"),
    cost_egp: taxiEstimate,
    duration_minutes: duration,
    color: "#06B6D4",
    icon: "car",
    line_id: null,
    line_number: null,
    info: tr(
      isArabic,
      "Fallback route while verified transit planning is unavailable.",
      "مسار احتياطي أثناء تعذر تخطيط المواصلات الموثقة.",
    ),
    instructions: [
      tr(isArabic, "Open a taxi app.", "افتح تطبيق تاكسي."),
      tr(isArabic, "Set your pickup to your current location.", "حدد نقطة الركوب عند موقعك الحالي."),
      tr(isArabic, "Enter your destination and confirm the ride.", "أدخل وجهتك وأكد الرحلة."),
      tr(isArabic, `Expected fare is about ${taxiEstimate} EGP.`, `التكلفة المتوقعة حوالي ${taxiEstimate} جنيه.`),
    ],
    route_geometry: routeGeometry,
    alternatives: [],
  };

  return {
    segments: [segment],
    total_cost_egp: taxiEstimate,
    total_duration_minutes: duration,
    budget_range: { min: Math.round(taxiEstimate * 0.8), max: Math.round(taxiEstimate * 1.35) },
    distance_km: Math.round(distanceKm * 10) / 10,
    plan: planKey,
    engine: "stable-fallback",
    planner_warning: reason,
  };
}

router.post("/", requireAuth, async (req, res) => {
  const startLat = asNumber(req.body.startLat);
  const startLng = asNumber(req.body.startLng);
  const endLat = asNumber(req.body.endLat);
  const endLng = asNumber(req.body.endLng);
  const language = typeof req.body.language === "string" ? req.body.language : "en";
  const isArabic = language === "ar";
  const planKey = planKeyFrom(req.body.tripType);

  if (startLat == null || startLng == null || endLat == null || endLng == null) {
    return res.status(400).json({ error: "startLat, startLng, endLat, and endLng are required numbers" });
  }

  const distanceKm = haversineKm(startLat, startLng, endLat, endLng);

  try {
    const plan = await withTimeout(
      planTripApi({
        origin: { lat: startLat, lng: startLng },
        dest: { lat: endLat, lng: endLng },
        planKey,
        isArabic,
        language,
      }),
      PLANNER_TIMEOUT_MS,
    );

    if (plan?.segments?.length) {
      return res.json(plan);
    }

    return res.json(
      await fallbackPlan({
        startLat,
        startLng,
        endLat,
        endLng,
        distanceKm,
        planKey,
        isArabic,
        reason: "No verified route was produced by the deterministic planner",
      }),
    );
  } catch (err) {
    console.error("Stable trip planner fallback:", err);
    return res.json(
      await fallbackPlan({
        startLat,
        startLng,
        endLat,
        endLng,
        distanceKm,
        planKey,
        isArabic,
        reason: err instanceof Error ? err.message : "Trip planner failed",
      }),
    );
  }
});

export default router;
