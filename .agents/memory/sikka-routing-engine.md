---
name: Sikka deterministic routing engine
description: Hard rules and design constraints for the city trip-planning engine (artifacts/api-server/src/engine)
---

# Sikka deterministic routing engine

The city trip planner (`POST /api/trips/plan`, city mode) is a deterministic
transfer-graph + Dijkstra search over verified DB data only. It lives in
`artifacts/api-server/src/engine/`.

## Hard rule (non-negotiable)
Routing must NEVER invent routes and must NOT use AI to generate them. Every
transit leg must reference a real `transit_lines` row (`lineId`). AI is allowed
ONLY for optional explanations, and must have a deterministic fallback.

**Why:** product correctness — users follow these directions on the ground; a
hallucinated metro line / imaginary station is worse than no answer.

**How to apply:**
- Do not reintroduce a fallback that fabricates metro/bus/serfis segments. The
  only legitimate non-graph fallback is a door-to-door taxi (Uber/Careem):
  a real, metered origin→dest ride with real coords, used solely when the
  engine throws. The pooled search already includes taxi as a competing mode, so
  that fallback should almost never fire.
- `computeEnginePlan` is a hard validation gate: return a plan ONLY if
  `validatePlan(plan).ok`. Never return a best-effort invalid plan.

## Constrained search (walk budget)
Walk caps derive from `WALK_MAX_KM` (0.8 km) in `cost.ts`: single-walk cap
`WALK_MAX_SINGLE_MIN` (~0.8 km worth) and total cap `WALK_MAX_TOTAL_MIN`
(~1.6 km worth, 2x single). Pathfinder + validate import these — do NOT hardcode
20/30 min anymore. **Why:** users complained walks were too long and cut through
blocks; any access gap over 0.8 km must be ridden, not walked. Total walking is a
path-dependent resource.
A plain one-label-per-node Dijkstra is INCORRECT here — it can discard a feasible
low-walk path for a cheaper high-walk one that later breaks the cap. The
pathfinder uses full Pareto-dominance labeling: per node keep all non-dominated
`(weight, totalWalk, contiguousWalk)` labels; one dominates another iff it is
`<=` on ALL THREE. First goal label popped from the weight-ordered heap is optimal.

**Why:** bucket-coalescing (an earlier attempt) still drops feasible labels and
fails review; exact dominance is the correct fix. The `contiguousWalk` term
(accumulates across consecutive walk edges, resets on any non-walk edge) is
REQUIRED: without it two sub-20-min walk edges chain through an unboarded stop
into one >20-min walk that a per-edge check misses — and because that all-walk
path is free, the cost-minimizing `economic` profile picked it, then it failed
`validatePlan`, and the whole rung returned "no plan" for short trips.

## Board-anywhere densification
Lines with `hasFixedStops=false` (bus/serfis/microbus) are densified at graph
build: synthetic stops sampled ~every 1 km along `route_path` (each labeled with
the nearest named stop via `displayName`, `synthetic=true`). This is what lets a
rider board at the NEAREST point and ride only the needed slice instead of
detouring to a sparse named hub. Rail keeps named stops only.

**How to apply:** synthetic stops must NOT inflate "ride N stops" counts — count
only non-synthetic stops; when zero named stops are ridden, instruct "stay on
~X km". Densification roughly 10×'s graph size (~3.6k→50k nodes); still tractable.

## Single mode pool (NOT a rung ladder)
The planner runs ONE pooled search over every mode (`ALL_MODES`), not a
rung-by-rung ladder. `findRoutes` returns up to K (6) non-dominated Pareto goal
candidates in ascending-weight order; `computeEnginePlan` reconstructs+validates
them in order and returns the first that passes the gates (else null → taxi
fallback). The K-best retry replaces the old ladder's "first valid rung wins"
robustness without restricting modes. The rider's tier
(economic/comfortable/premium) ONLY changes the PROFILES weight vector
(timeW/costW/walkW/modePref) — it does NOT gate which modes exist. A fixed
boarding/transfer penalty `BOARDING_PENALTY_MIN` (7 min ≈ 420 s, added as
`baselineTimeW * 7` so it is a real 7-min time cost at every tier) replaced the
old per-profile `transferPenalty` (6/14/26). **Why:** weights+penalty should
shape the route in one search; the ladder was harder to reason about and could
miss cross-mode optima. **Consequence:** taxi now competes directly, so
comfortable picks direct taxi for short trips and economic uses taxi only as a
heavily-penalized last-mile connector — this is intended, tune via PROFILES.

`buildOverlay(graph, origin, dest, planKey)` builds first/last-mile connectors via
a single `connect(from,to,distKm)` helper. Connector policy (ALL profiles):
walk only if `distKm <= WALK_MAX_KM` (0.8 km); a longer gap is filled on-street by
a tuktuk (economic/comfortable only, ≤3 km) and/or a taxi (every profile, ≤5 km).
Premium additionally always offers a door-to-door taxi for any distance.
(There is no separate "detour cap" rung in the current code — `validatePlan` is
the only hard gate; do not assume one exists.)

Connector edges (walk/taxi/tuktuk) exist ONLY as overlay injections — there are
no taxi/tuktuk "lines" in the base graph. In `pathfinder.ts` only `walk` is in
`CONNECTOR_MODES` (always traversable); taxi/tuktuk must be in the search's
`allowed` set — but since the pool is now `ALL_MODES`, every connector mode is
available and whether a given connector edge exists at all is still decided in
`buildOverlay`. Tuktuk additionally obeys the heatmap gate inside the pathfinder.

**Why:** the original engine forced boarding at sparse named stops, so short
trips detoured through far hubs (real failure: El Narges→Nasr City became a 75-min
2-bus chain or a full-12 km Uber). The 0.8 km walk cap then required motorized
connector fill so tightened walking does not make access gaps unroutable.

## Connector geometry snapping
Connector legs are stored as a straight 2-point line; `adaptPlanToApi` is async
and snaps them onto the real network in `onStreetGeometry`. WALK legs use OSRM's
foot profile (`snapFootOsrm()` in `routePathGenerator.ts`) — pedestrian network,
NO API token, FOSSGIS public instance `routing.openstreetmap.de/routed-foot` by
default, override with `OSRM_FOOT_URL`. On OSRM failure walk falls back to Mapbox
`snapConnector("walking")`, then to a straight interpolation. TAXI/TUKTUK legs
use Mapbox `snapConnector("driving")`. Both helpers are coord-cached and return
null on failure. Transit legs keep their DB `route_path` polyline (never reshaped).
**Why:** straight diagonals cut through blocks and looked wrong; OSRM foot keeps
walk legs on real pedestrian paths and removes the Mapbox dependency for walking
(part of the wider Mapbox→MapLibre/OSS migration). NOTE: the public OSRM demo
`router.project-osrm.org` is CAR-ONLY (its "foot" returns car speeds) — must use
a real foot instance like FOSSGIS.

## Fare markup + budget band
`cost.ts` `FARE_MARKUP` (1.25) is applied ONCE each in `directFare`,
`boardingFare`, `rideCostPerKm` so transit + taxi/tuktuk fares all rise together
(no double-marking — line fares marked at board/ride edge, connector fares via
`directFare`, totals derive from those). API `budget_range` is `min*0.8 / max*1.6`.
**Why:** users said prices were too strict/low; the band is an estimate, not an
exact fare.

## Distances
Compute transit-leg `distanceKm` from consecutive `line.stops[]` haversine, NOT
from `pathLengthKm(route_path)` — some stored polylines are noisy/corrupt and
inflate distance wildly (saw a 162 km Maadi→Heliopolis metro leg). The polyline
is kept for map display only.

## Pre-delivery validation gates + geometry stitching
`validatePlan(plan, graph?)` is the hard gate before any plan is returned. Beyond
basic connectivity it enforces, for transit legs only (CONNECTOR_MODES walk/taxi/
tuktuk are exempt): `stop_not_on_line` (board/alight coord must be ≤300m from the
line's road-snapped `path`, not just its stop list — checking the path is the
meaningful test; vs the stops list is trivially true), `geometry_cut` (two adjacent
transit legs' drawn polyline endpoints must be ≤50m apart), `unbridgeable_transfer`
(adjacent transit legs' logical transfer ≤800m). `stop_not_on_line` measures
point-to-SEGMENT distance to the path (not nearest-vertex) so sparse polylines
don't false-reject. Slicing uses each stop's authoritative `pathIndex` (falls back
to nearest-vertex only if missing). `adaptPlanToApi` runs `stitchSegmentGeometry`:
it ONLY reshapes connector legs — a connector endpoint is moved to the adjacent
transit endpoint, and first/last is pinned to origin/dest only when that boundary
leg is itself a connector. Transit↔transit boundaries are NEVER snapped (moving a
transit vertex would alter a fixed route); a real transit-transit cut is left
intact and rejected by `geometry_cut` (50m) instead.

**Why:** users saw map polylines that cut/teleported and routes on lines whose
stored geometry doesn't actually serve the boarded stop (the known partly-corrupt
`route_path` data — see sikka-stop-dictionary.md). The rule "never alter a fixed
route, only board/alight may change" means we cannot fake continuity by moving a
transit vertex — so a plan with a real transit-transit cut is REJECTED, not patched.

**How to apply:** when these gates reject every transit candidate, `computeEnginePlan`
returns null and the route layer (`tripPlan.ts`) serves `generateFallbackPlan` (a
verified door-to-door taxi) — the app never shows a blank/"no route". This is the
intended reliability tradeoff (reject unreliable transit, serve a real fallback);
re-enriching the corrupt paths is separate work, not a reason to loosen the gates.
Geometry_cut is intentionally scoped to transit-transit pairs only (connector gaps
are closed by the stitch pass), which deviates from a naive "all boundaries" reading.

## Scope boundary
The intercity flow (`buildIntercityPlan`, SuperJet/GoBus/BlueBus adapters) is a
SEPARATE feature. Its synthetic-estimate fallback when adapters return no live
trips predates this engine and is intentionally left unchanged — it is not part
of the city routing-engine spec.
