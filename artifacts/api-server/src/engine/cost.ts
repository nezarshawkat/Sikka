import type { ModeKey, PlanKey, TransportTypeInfo, LineInfo } from "./types.js";

// Map a transport_type name onto a canonical engine mode.
export function modeOfType(nameEn: string): ModeKey {
  const n = nameEn.toLowerCase();
  if (n.includes("metro")) return "metro";
  if (n.includes("monorail")) return "monorail";
  if (n.includes("train") || n.includes("قطار")) return "train";
  if (n.includes("serfis") || n.includes("سرفيس")) return "serfis";
  if (n.includes("microbus") || n.includes("ميكروباص")) return "microbus";
  if (n.includes("tuktuk") || n.includes("توك")) return "tuktuk";
  if (n.includes("taxi") || n.includes("uber") || n.includes("careem") || n.includes("car"))
    return "taxi";
  if (n.includes("bus") || n.includes("أتوبيس")) return "bus";
  return "bus";
}

// Default wait (minutes) when a line has no frequency data. Halved on use.
const DEFAULT_FREQUENCY: Record<ModeKey, number> = {
  metro: 6,
  monorail: 8,
  train: 30,
  bus: 18,
  serfis: 10,
  microbus: 10,
  taxi: 6,
  tuktuk: 5,
  walk: 0,
};

export function waitMinutesFor(line: LineInfo | null, mode: ModeKey): number {
  const freq = line?.frequencyMinutes ?? DEFAULT_FREQUENCY[mode];
  return Math.max(0, freq / 2);
}

// Walking speed (km/h) for pedestrian legs.
export const WALK_SPEED_KMH = 4.5;

// Real pedestrian paths are longer than the straight-line (haversine) distance
// between two points. Apply a circuity factor so walking time reflects actual
// on-street routes (sidewalks, crossings, detours) instead of an as-the-crow-flies
// underestimate. ~1.3 is the standard urban pedestrian network detour ratio.
export const WALK_DETOUR_FACTOR = 1.3;

export function walkMinutes(km: number): number {
  return ((km * WALK_DETOUR_FACTOR) / WALK_SPEED_KMH) * 60;
}

// Hard walking limit: a rider should never walk more than ~0.8 km in one go.
// Any longer access gap is bridged by an on-street connector (tuktuk/taxi).
export const WALK_MAX_KM = 0.8;
export const WALK_MAX_SINGLE_MIN = walkMinutes(WALK_MAX_KM); // ~10.7 min
export const WALK_MAX_TOTAL_MIN = walkMinutes(WALK_MAX_KM * 2); // ~21.3 min

// Fixed boarding/transfer penalty (~420 s ≈ 7 min) charged once per boarding in
// the unified single-pool search. Added as a time-equivalent (scaled by the
// profile's time weight) so it is a real 7-minute cost at every tier instead of
// a raw weight constant that would mean different things per profile.
export const BOARDING_PENALTY_MIN = 7;

// Global fare markup so quoted prices lean toward real-world (slightly higher)
// fares instead of optimistic seed values. Applied to every fare the engine
// emits so weights and displayed costs stay consistent.
export const FARE_MARKUP = 1.25;

// Boarding fare charged once when entering a line. Per-km types charge a small
// base on boarding and accumulate distance cost on ride edges; flat-fare types
// (metro/monorail/bus) charge the line's full fare on boarding.
export function boardingFare(type: TransportTypeInfo, line: LineInfo | null): number {
  const base = type.pricePerKmEgp > 0 ? type.basePriceEgp : line?.priceEgp ?? type.basePriceEgp;
  return base * FARE_MARKUP;
}

export function rideCostPerKm(type: TransportTypeInfo): number {
  return type.pricePerKmEgp * FARE_MARKUP;
}

export function directFare(type: TransportTypeInfo, km: number): number {
  return Math.round((type.basePriceEgp + type.pricePerKmEgp * km) * FARE_MARKUP);
}

// Reliability proxy per mode (0..1) used in scoring. Rail is most reliable.
export const RELIABILITY: Record<ModeKey, number> = {
  metro: 0.95,
  monorail: 0.95,
  train: 0.85,
  bus: 0.65,
  serfis: 0.7,
  microbus: 0.6,
  taxi: 0.8,
  tuktuk: 0.65,
  walk: 1.0,
};

// ── Plan profiles ─────────────────────────────────────────────────────────
// Each profile turns an edge into a scalar Dijkstra weight. Lower is better.
export interface PlanProfile {
  key: PlanKey;
  timeW: number; // weight per minute
  costW: number; // weight per EGP
  walkW: number; // extra weight per walking minute
  // multiplier applied to a board edge's weight by the boarded mode
  modePref: Record<ModeKey, number>;
  allowTaxi: boolean;
  allowTuktuk: boolean;
}

// Preference multipliers: <1 encourages a mode, >1 discourages it.
export const PROFILES: Record<PlanKey, PlanProfile> = {
  economic: {
    key: "economic",
    timeW: 0.6,
    costW: 3.0,
    walkW: 0.5,
    modePref: {
      walk: 0.8,
      bus: 0.85,
      serfis: 0.9,
      microbus: 0.9,
      metro: 1.0,
      monorail: 1.2,
      train: 1.1,
      taxi: 2.2,
      tuktuk: 1.4,
    },
    allowTaxi: false,
    allowTuktuk: true,
  },
  comfortable: {
    key: "comfortable",
    timeW: 1.2,
    costW: 1.0,
    walkW: 1.6,
    modePref: {
      metro: 0.8,
      monorail: 0.85,
      train: 0.95,
      bus: 1.0,
      serfis: 1.05,
      microbus: 1.1,
      taxi: 1.1,
      tuktuk: 1.3,
      walk: 1.0,
    },
    allowTaxi: true,
    allowTuktuk: true,
  },
  premium: {
    key: "premium",
    timeW: 2.4,
    costW: 0.25,
    walkW: 3.0,
    modePref: {
      taxi: 0.7,
      metro: 0.9,
      monorail: 0.9,
      train: 1.0,
      bus: 1.2,
      serfis: 1.25,
      microbus: 1.3,
      tuktuk: 1.2,
      walk: 1.0,
    },
    allowTaxi: true,
    allowTuktuk: true,
  },
};
