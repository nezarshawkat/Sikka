# Sikka update — 2026-08-13

37 files, applied on top of the existing repo. Extract at the repo root
(overwrites matching paths, adds new ones). Version bumped to
versionCode 36 / versionName 1.0.35 in `android/app/build.gradle`.

## 1. Arabic map text was reversed/disconnected
Root cause: the app's map (`react-map-gl/maplibre` + OpenFreeMap vector
styles) never had MapLibre's RTL text plugin registered. Without it, MapLibre
doesn't shape/join complex scripts like Arabic — letters render as isolated,
disconnected glyphs in the wrong order, which is exactly what you saw.
- Bundled `@mapbox/mapbox-gl-rtl-text` locally at
  `public/vendor/mapbox-gl-rtl-text.js` (works offline in the Android
  WebView, not just online).
- Registered it in `src/main.tsx` via `maplibregl.setRTLTextPlugin(...)` at
  startup.

## 2. Tuk-tuk icon
Found the actual bug: the *online* engine tags tuktuk segments `icon: "bike"`
and every icon-lookup table recognized that — but the *offline* trip planner
tags the same segments `icon: "tuktuk"`, which no lookup table recognized,
so offline-planned tuktuk legs silently fell back to a plain bus emoji.
Added the missing `tuktuk` key (same 🛺 emoji) to all 4 duplicated icon maps:
`TripGuideSheet.tsx`, `AdminMap.tsx`, `TripResult.tsx`, `RouteDetail.tsx`.

## 3. Tuk-tuk available everywhere
Your online backend planner already gated tuktuk to admin-drawn heatmap
zones (`insideModeHeatmap` in the engine). The **offline** fallback planner
(`offlineTripPlanner.ts`) had no such check — it offered tuktuk anywhere
within 3.5km for economic-tier plans, regardless of location. Ported the
same haversine-distance-to-heatmap-zone check into the offline planner,
resolving against the tuktuk transport type in the bundled snapshot's
heatmap data. Falls back to taxi when tuktuk isn't actually available at
that location, rather than offering nothing.

## 4. POI names — skipped
Per your note, this already exists; no changes made.

## 5 & 6. Discovery must be a new route / Contribute-from-profile
Traced the full pipeline. Your Profile "Contribute a route" button and the
"Discover a new journey" flow already funnel into the identical
`DiscoverTrip.tsx` recording flow — that part was already correct.

The real bug was server-side in `transportReports.ts`: when a submission's
GPS trace geometrically resembled an existing transit line, the "safe merge"
path (create a separate copy for admin review, rather than editing the
matched line) was only applied to `trip`/`native`-sourced discoveries.
Submissions tagged `profile`/`manual` — i.e. everything from your
Contribute/Discover flow — went straight into `db.update(transitLinesTable)`,
silently overwriting the existing route in place.

Fixed by widening that protection to all discovery sources. Confirmed
end-to-end behavior now matches what you described: a new discovery
submission can only ever merge into a route that was *itself* created by
this same mechanism (`routeQuality.source === "trip_discovery_copy"`) —
never an original/established route. Two new discovered routes with
matching paths merge into each other and accumulate a report count
(`routeQuality.metrics.matchedReportCount`), already surfaced in
`AdminRoutes.tsx` as "Confidence: X% · Reports: N".

## 7. "Open in Taxi Apps" — Android destination sharing
Replaced the previous generic "share as text" flow with Android's `geo:`
intent + `Intent.createChooser` — the standard mechanism ride/taxi apps
register for (the same one behind "get a ride" buttons in other apps).
No hardcoded package names or app names anywhere.
- `SikkaSharePlugin.java`: new `openDestination` method building a
  `geo:lat,lng?q=lat,lng(name)` (or `geo:0,0?q=name` when only a name is
  known) intent, wrapped in a forced chooser.
- `nativeShare.ts` / `TaxiAppButton.tsx`: try the native chooser first
  (passing destination lat/lng when known), fall back to the previous
  share-sheet flow on web or if unavailable.
- `TripGuideSheet.tsx`: now derives destination coordinates from the
  segment's route geometry (or the trip's final destination for the last
  leg) and passes them through.

## 8. Intercity search fix
This was the deepest fix. Findings and changes:

**Bus adapters were returning fabricated data.** All three
(`superjet.ts`, `gobus.ts`, `bluebus.ts`) hit either scraped or guessed
endpoints and, on any failure, silently returned **hardcoded fake trip
times/prices** instead of an empty result. Since the SuperJet scraper's CSS
selectors and BlueBus's GraphQL schema are unverified guesses, this fake
data was very likely showing up often. Removed all three fallbacks — a
failed/unavailable search now honestly returns zero results instead of
inventing a schedule. I could not verify these three operators' live
endpoints from my sandboxed environment (network access is restricted to
package registries only), so I could not confirm whether the underlying
scrape/API calls succeed in your environment — only that the fake-data
fallback itself was wrong and is now gone.

**SuperJet ID-space bug.** The search was passing this app's own internal
city id (e.g. `"cairo"`) straight into SuperJet's booking form as if it
were SuperJet's own internal city ID — a completely different ID space
scraped separately via `getSuperJetCities()`, which was never actually
called. Fixed: now resolves SuperJet's real city ID by name match before
searching, and skips calling SuperJet entirely (contributing zero results,
rather than a guaranteed-wrong request) when either end can't be resolved.

**Train governorate list was wrong.** `TrainSearch.tsx` was using the same
all-27-governorate list as buses (`/api/intercity/governorates`). Egypt's
rail network doesn't reach everywhere — there's no line into Sinai at all,
for example — so picking an unreachable destination guaranteed a "no trains
found" search. Added `GET /api/trains/governorates`, derived from the real
seeded timetables (every `fromCity`/`toCity`/stop actually in the data,
resolved to a governorate), and pointed `TrainSearch.tsx` at it instead.
Also gated the "Train" choice in `IntercityChoiceDialog` the same way
Flight/Nile already are (`TRAIN_CITY_IDS` in `Index.tsx`), so Train isn't
even offered as an option when the destination isn't rail-served.

**Current governorate now auto-fills "from".** Per your instruction, both
the bus search (`Intercity.tsx`) and train search (`TrainSearch.tsx`) now
resolve the rider's current governorate via geolocation + nearest-city match
when there's no explicit `?from=` handoff already, so the rider only has to
pick a destination.

**Airport.** Already correctly gated by a real list of Egyptian
governorates with commercial airports (`FLIGHT_CITY_IDS` in `Index.tsx`:
Cairo, Alexandria, Luxor, Aswan, Hurghada, Sharm El-Sheikh). I could not
verify a practical free/keyless live flight-schedule API from this sandbox
(the well-known options — AviationStack, FlightAware, AeroDataBox — all
require a paid tier or API key), so per your fallback instruction I left
the existing behavior (external EgyptAir link) unchanged rather than
guessing at an integration.

**Taxi.** Unchanged — continues through the destination-share flow from
item 7.

**Known limitation, disclosed rather than guessed around:** I have no
verified source for which specific governorates SuperJet/GoBus/BlueBus each
individually serve (that would require live access to their booking sites,
which this sandbox can't reach), so bus governorate options are left as the
full existing list rather than restricted per-operator. A route a specific
operator doesn't actually run will now honestly show zero results from that
operator instead of fake ones.

## 9. Trip notification icon
Replaced the "first letter of the transport name in a colored circle"
notification badge with actual per-mode vector icons.
- 11 new hand-drawn vector drawables in `res/drawable/`: bus, metro, train,
  monorail, LRT, BRT, car/taxi, tuktuk, walk, ship, plane.
- `SikkaTripNotificationPlugin.java`: draws the matching glyph based on the
  segment's existing `icon` key (same keys the web UI's icon maps already
  use); falls back to the old letter badge only for unrecognized keys.
- Wired the segment's `icon` through `Index.tsx` → `useTripNotification` →
  `nativeTripNotification.ts` → the native plugin.

## 10. Release version bump
`android/app/build.gradle`: versionCode 35→36, versionName 1.0.34→1.0.35.
Release signing config was already in place — no changes needed there.

## Bonus: Chinese language completeness
You mentioned Chinese already exists as a language — it did, but only
~35% of strings were actually translated (182 keys were silently falling
back to English). Translated all of them in `src/lib/i18n.ts`; verified
zero remaining gaps against the English key set.

---

### Files in this delta
See the folder structure below — every path is relative to your repo root
and can be extracted directly over the existing tree.
