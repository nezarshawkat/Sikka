import type { EnginePlan, ModeKey, TransitGraph } from "./types.js";
import { WALK_MAX_SINGLE_MIN, WALK_MAX_TOTAL_MIN } from "./cost.js";
import { haversineKm } from "./geo.js";

// Small tolerance over the search caps to absorb rounding in merged walk legs.
const MAX_TOTAL_WALK_MIN = WALK_MAX_TOTAL_MIN + 0.5; // ~1.6 km total
const MAX_SINGLE_WALK_MIN = WALK_MAX_SINGLE_MIN + 0.5; // ~0.8 km per segment

// Flexible "connector" legs that bridge gaps; everything else is fixed transit.
const CONNECTOR_MODES = new Set<ModeKey>(["walk", "taxi", "tuktuk"]);

const DISCONNECT_KM = 0.25; // logical transfer points should coincide (~250 m)
// Adjacent transit polylines must touch (~50 m). Transit geometry is NEVER
// reshaped to hide a gap (that would alter a fixed route), so this threshold is
// the largest cut tolerated as visually negligible; anything larger is rejected.
const GEOMETRY_CUT_KM = 0.05;
const STOP_MEMBERSHIP_KM = 0.3; // board/alight must sit on the line path (~300 m)
const TRANSFER_GAP_KM = 0.8; // max unbridged direct transit→transit gap (800 m)

export interface ValidationResult {
  ok: boolean;
  reasons: string[];
}

function asCoord(pt: [number, number]) {
  return { lng: pt[0], lat: pt[1] };
}

// Shortest distance (km) from a point to a path SEGMENT a→b, using a local
// equirectangular projection centered on the point. Checking segments (not just
// vertices) avoids false "off-line" rejects when the road-snapped path is sparse.
function pointToSegmentKm(
  c: { lat: number; lng: number },
  a: [number, number],
  b: [number, number],
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const cosLat = Math.cos(toRad(c.lat));
  const ax = toRad(a[0] - c.lng) * cosLat * R;
  const ay = toRad(a[1] - c.lat) * R;
  const bx = toRad(b[0] - c.lng) * cosLat * R;
  const by = toRad(b[1] - c.lat) * R;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? (-ax * dx + -ay * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(qx, qy);
}

// Simulate the journey end-to-end and reject anything impossible or
// unsupported. A route may only pass if every leg is backed by real data and
// the whole chain is connected, followable, and physically transferable.
//
// When the graph is supplied, transit legs are additionally checked against the
// real line geometry so the displayed line number genuinely serves both the
// boarding and alighting points.
export function validatePlan(plan: EnginePlan, graph?: TransitGraph): ValidationResult {
  const reasons: string[] = [];

  if (plan.legs.length === 0) {
    reasons.push("empty_plan");
    return { ok: false, reasons };
  }

  let totalWalk = 0;
  for (const leg of plan.legs) {
    if (leg.mode === "walk") {
      totalWalk += leg.timeMin;
      if (leg.timeMin > MAX_SINGLE_WALK_MIN) reasons.push("single_walk_exceeded");
    }
    // Transit legs must reference a real line; taxi/tuktuk are point-to-point.
    if (!CONNECTOR_MODES.has(leg.mode) && !leg.lineId) {
      reasons.push("unverified_transit_leg");
    }
    // Every leg must have geometry so the user can actually follow it.
    if (!leg.geometry || leg.geometry.length < 2) {
      reasons.push("missing_geometry");
    }
    if (leg.timeMin <= 0 || Number.isNaN(leg.timeMin)) reasons.push("invalid_timing");

    // Stop membership: a transit leg's board/alight coords must actually lie on
    // the referenced line's road-snapped path. Catches bad data where a stop was
    // geocoded off the real route — i.e. a line that doesn't truly serve it.
    if (graph && leg.lineId && !CONNECTOR_MODES.has(leg.mode)) {
      const line = graph.lines.get(leg.lineId);
      if (!line) {
        reasons.push("unverified_transit_leg");
      } else if (line.path && line.path.length >= 2) {
        const path = line.path;
        const nearPath = (c: { lat: number; lng: number }) => {
          for (let k = 0; k < path.length - 1; k++) {
            if (pointToSegmentKm(c, path[k], path[k + 1]) <= STOP_MEMBERSHIP_KM) return true;
          }
          return false;
        };
        if (!nearPath(leg.startCoord) || !nearPath(leg.endCoord)) {
          reasons.push("stop_not_on_line");
        }
      }
    }
  }

  if (totalWalk > MAX_TOTAL_WALK_MIN) reasons.push("total_walk_exceeded");

  // Pairwise continuity / transfer feasibility.
  for (let i = 1; i < plan.legs.length; i++) {
    const prev = plan.legs[i - 1];
    const cur = plan.legs[i];

    // Logical transfer: each leg should start where the previous one ended.
    if (haversineKm(prev.endCoord, cur.startCoord) > DISCONNECT_KM) {
      reasons.push("disconnected_transfer");
    }

    const prevTransit = !CONNECTOR_MODES.has(prev.mode);
    const curTransit = !CONNECTOR_MODES.has(cur.mode);

    // Two transit legs with no connector between them must (a) render as one
    // continuous polyline and (b) be physically transferable on foot. Connector
    // boundaries are excluded here: the geometry stitch pass closes those, and
    // moving a flexible connector endpoint never reshapes a fixed route.
    if (prevTransit && curTransit) {
      if (prev.geometry?.length && cur.geometry?.length) {
        const gap = haversineKm(
          asCoord(prev.geometry[prev.geometry.length - 1]),
          asCoord(cur.geometry[0]),
        );
        if (gap > GEOMETRY_CUT_KM) reasons.push("geometry_cut");
      }
      if (haversineKm(prev.endCoord, cur.startCoord) > TRANSFER_GAP_KM) {
        reasons.push("unbridgeable_transfer");
      }
    }
  }

  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}
