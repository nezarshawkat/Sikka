import type { Coord, HeatPoint, ModeKey } from "./types.js";
import { haversineKm } from "./geo.js";

// Cairo rush-hour windows (local hours). Crowding rises sharply in these.
function rushFactor(date = new Date()): number {
  // Use UTC+2 (Cairo, no DST since 2014 for most of the year — good enough heuristic).
  const h = (date.getUTCHours() + 2) % 24;
  const morning = h >= 7 && h <= 10;
  const evening = h >= 16 && h <= 20;
  if (morning || evening) return 1.0;
  if ((h >= 11 && h <= 15) || (h >= 21 && h <= 22)) return 0.55;
  return 0.3; // late night / early morning
}

// Base crowding tendency per mode (0..1) before time-of-day adjustment.
const MODE_BASE: Record<ModeKey, number> = {
  metro: 0.8,
  monorail: 0.4,
  train: 0.5,
  bus: 0.7,
  serfis: 0.55,
  microbus: 0.65,
  taxi: 0.2,
  tuktuk: 0.3,
  walk: 0.0,
};

export type CrowdLevel = "low" | "medium" | "high";

export function estimateCrowding(
  mode: ModeKey,
  at: Coord,
  heatPoints: HeatPoint[],
  date = new Date(),
): CrowdLevel {
  let score = MODE_BASE[mode] * rushFactor(date);

  // Nearby demand hotspots (tuktuk / white-taxi availability zones double as
  // general demand signals) nudge crowding upward.
  let demand = 0;
  for (const hp of heatPoints) {
    const d = haversineKm(at, hp.coord);
    if (d <= hp.radiusKm) {
      demand += hp.intensity * (1 - d / hp.radiusKm);
    }
  }
  score += Math.min(0.25, demand * 0.15);

  if (score >= 0.7) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

export function crowdingPenalty(level: CrowdLevel): number {
  return level === "high" ? 1 : level === "medium" ? 0.5 : 0;
}
