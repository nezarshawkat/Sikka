---
name: Sikka trip experience & auth
description: How the active-trip guide, reviews/reports, and request auth work in Sikka
---

# Sikka active-trip experience

- Flow: `pages/TripPlan.tsx` writes sessionStorage `tripPlan` then navigates to `/trip-result` (review page). `TripResult.tsx`'s "Start guide" button navigates to `/` (home) to begin the live trip. `pages/Index.tsx` reads `tripPlan`, draws per-segment road geometry on the home Mapbox map, and renders `components/trip/TripGuideSheet.tsx` (bottom sheet, defaults EXPANDED) with live GPS via `hooks/useTripTracking.ts`.
- **Why:** users wanted a review/options screen before committing to the live guide; don't collapse the plan→review→home flow back into a direct navigate('/').

# AI segment ids are slugs, not UUIDs
- `/api/trips/plan` segments use slug `transport_type_id` like `metro`/`bus`/`car` (NOT DB UUIDs).
- **Why:** the AI generates them freely; they don't map 1:1 to `transport_types` rows.
- **How to apply:** when persisting reviews/reports, UUID-gate the id (regex) and send `null` if it's a slug; preserve attribution by also sending `meta.transportName`/`meta.transportSlug` so admin analytics can still group. Never pass a slug into a uuid column — it 500s.

# Request auth is cookie-based Clerk (no Bearer token)
- `lib/api.ts` sends `credentials: "include"` + optional `X-Admin-Token` only. It does NOT add an `Authorization: Bearer` header (despite older replit.md notes).
- The API `clerkAuth` middleware uses `getAuth(req)` from `@clerk/express`, which reads the Clerk session from the `__session` cookie. `X-Admin-Token` is a phone-session fallback.
- **Why:** a code review flagged "missing Bearer token" as a bug — it is a FALSE POSITIVE. Cookie-based Clerk works and all `requireAuth` endpoints rely on it.
- **How to apply:** don't "fix" auth by injecting Bearer tokens; verify cookie propagation instead.

# transport_types categorization
- Columns `governmentType` ('government'|'private') and `category` ('economic'|'comfortable'|'premium') drive AI trip-type selection (economic/comfortable/premium). Seeded per type.

## Choosing a destination on the home map
- The home map (`Index.tsx`) supports picking a destination two ways: search autocomplete OR tapping the map. Both funnel through the SAME `handleDestinationSelect({ place_name, center: [lng, lat] })` (intercity-check → navigate to `/plan`). Add new destination sources by reusing that one entry point, not by duplicating the plan-navigation logic.
- Map taps reverse-geocode via the in-file Mapbox `reverseGeocode(lat,lng)` helper and confirm via a card before planning (avoids accidental trips). Guard tap handling while `activeTrip` or a blocking dialog (e.g. intercity choice) is open.
