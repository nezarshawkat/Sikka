# Sikka update — Discovery pipeline overhaul

11 files. Apply at repo root: `unzip -o` this into your Codespace.
Version bumped to versionCode 38 / versionName 1.0.37.

## ⚠️ Required manual step before deploying
A new `routeStatus` value ("rejected") was added to the database enum in
`lib/db/src/schema/sikka.ts`. This is schema-driven (drizzle-kit push), not a
migration file — after pulling this in, run from `lib/db`:
```
pnpm push
```
against your real database before the backend that uses "rejected" goes live,
or inserts/updates using that status will fail.

## The critical bug you asked me to look into
Compared native trip-discovery's GPS collection (Android LocationManager,
throttled to 5s/5m minimums) against manual contribution's (raw
`watchPosition`, no throttling at all). Unthrottled high-accuracy GPS fires
rapidly with normal jitter — a few meters of noise over a fraction of a
second computes to an "impossible" speed, which is what was silently
rejecting nearly every manual contribution while trips worked fine. Fixed at
the source in both places it happens (`Index.tsx`'s recorder and
`ContributeTransportDialog.tsx`'s own internal recorder), plus a server-side
floor as a second layer of defense.

## Item-by-item

**1 — Map in the pending card.** `AdminDiscovery.tsx` now embeds a live map
directly in every card, not just after acceptance.

**2 & 5 — Accepted routes on the Routes page.** Checked first: this already
worked via the existing Source=Discovery filter in `AdminRoutes.tsx`,
combinable with the status filter to see all accepted discovery routes. No
changes needed there.

**3 — Confidence/reports shown consistently.** Since pending and rejected
now share one card component, this is automatic.

**4 — Accepted routes removed from Discovery.** The Discovery page only ever
queries `routeStatus=needs_review` or `routeStatus=rejected` — accepted
(active) routes never appear there, only on Routes.

**6 — Quality-improve button, now with provider choice.** Clicking "Improve
route quality" opens a popup to choose Valhalla or OSRM specifically,
instead of only the automatic waterfall. Backend's `snapDiscoveryTrace` now
accepts a forced-provider mode.

**7 — Multi-color trace blending.** Each contributing report's own GPS trace
is now stored with an assigned color. The card's map renders each trace
separately; where two or more run close together, that stretch blends into
a mixed color (real RGB averaging over resampled, distance-checked points —
`src/lib/traceBlend.ts`). Once a route is snapped into one clean line, it
carries a `blendedColor` (average of all its contributors) so the single
final line still visually reflects the mix.

**8 — Boarding point auto-filled.** New `/transport-reports/reverse-geocode`
endpoint resolves a bilingual name from the GPS trace's own start point.
The Contribute dialog now shows this read-only instead of a text field —
only the destination stays manually typed.

**9 — Bilingual names, automatic.** New `searchBilingualPlace` /
`reverseGeocodeBilingual` helpers (Nominatim, same free/keyless service
already used elsewhere in the project) resolve whichever of Arabic/English
wasn't typed. Wired into the actual promotion path — previously `nameEn`
and `nameAr` were just the same string duplicated. Discovery cards now show
both names when they differ.

**10 — Partial route is now the default**, both as the component's default
prop and on reset.

**11 — Analytics.** New "Discovered This Month" card on `AdminAnalytics.tsx`,
backed by a new `discoveredLastMonth` field on the analytics endpoint
(count of discovery-sourced routes created in the last 30 days).

**12 — Failed contributions are saved, not lost.** Both rejection points in
the submit handler (raw-trace validation, road-snap validation) now insert
a `routeStatus: "rejected"` line with whatever geometry exists, the specific
reason, and a recoverability score — instead of just responding to the
client and discarding everything.

**13 — Filters + search.** Status (Pending/Rejected) and transport type
(Bus/Microbus) selects, plus a search box, all styled to match the existing
Select/Input components used on the Routes page.

**14 — Rejected card actions.** "Move to pending" and "Delete" buttons on
every rejected card (both reuse existing endpoints — no new ones needed).
Rejected routes older than 7 days are deleted automatically as a side
effect of listing (`GET /transit-lines`) — no separate cron job required.
The rejected sort runs least-recoverable-first as literally requested; a
label above the list makes the direction explicit. The retry-snap button's
failure reason now renders inline under the button, not just as a toast.

## One thing I could not verify
I don't have a way to hit your live Nominatim/Valhalla/OSRM endpoints from
my sandbox (network is restricted to package registries only), so the new
bilingual geocoding and provider-choice retry are implemented against the
same patterns your existing geocoding code already uses, but I could not
test them against live traffic. Worth watching the first few real
contributions after deploying.
