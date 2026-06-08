import type { EnginePlan, PlanLeg } from "./types.js";
import { RELIABILITY } from "./cost.js";
import { crowdingPenalty } from "./crowding.js";

// Quality score 0–100. Higher is better. Combines time, cost, walking, transfers,
// reliability and crowding. Weighting shifts slightly per plan intent.
export function scorePlan(plan: EnginePlan): number {
  const { totalTimeMin, totalCostEgp, totalWalkMin, transfers, legs, distanceKm } = plan;

  // Reference baselines for normalization (a direct taxi-ish trip).
  const refTime = Math.max(15, distanceKm * 2.5); // minutes
  const refCost = Math.max(15, distanceKm * 4); // EGP

  const timeScore = clamp01(1 - (totalTimeMin - refTime * 0.5) / (refTime * 1.5));
  const costScore = clamp01(1 - (totalCostEgp - refCost * 0.2) / (refCost * 1.3));
  const walkScore = clamp01(1 - totalWalkMin / 30);
  const transferScore = clamp01(1 - transfers / 4);

  const reliability = avg(legs.map((l) => RELIABILITY[l.mode] ?? 0.7));
  const crowd =
    1 - avg(legs.map((l) => crowdingPenalty(l.crowding))) * 0.5; // crowding lowers score

  let w: { t: number; c: number; w: number; x: number; r: number; cr: number };
  if (plan.plan === "economic") w = { t: 0.15, c: 0.4, w: 0.12, x: 0.12, r: 0.11, cr: 0.1 };
  else if (plan.plan === "premium") w = { t: 0.4, c: 0.08, w: 0.18, x: 0.16, r: 0.1, cr: 0.08 };
  else w = { t: 0.25, c: 0.22, w: 0.15, x: 0.15, r: 0.13, cr: 0.1 };

  const score =
    w.t * timeScore +
    w.c * costScore +
    w.w * walkScore +
    w.x * transferScore +
    w.r * reliability +
    w.cr * crowd;

  return Math.round(clamp01(score) * 100);
}

// Data confidence for the whole plan derived from leg modes (official rail = high).
export function planConfidence(legs: PlanLeg[]): "low" | "medium" | "high" {
  const conf = legs.map((l) => {
    if (l.mode === "metro" || l.mode === "monorail" || l.mode === "train") return 3;
    if (l.mode === "taxi" || l.mode === "tuktuk" || l.mode === "walk") return 3;
    if (l.mode === "bus") return 2;
    return 2; // serfis / microbus — community-verified
  });
  const min = Math.min(...conf);
  return min >= 3 ? "high" : min >= 2 ? "medium" : "low";
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
