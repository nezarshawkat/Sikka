# Sikka changes — summary

Applies cleanly to the repo as of the zip you uploaded. Two ways to apply it in Codespace:

1. **Patch**: `git apply sikka-changes.patch` from the repo root (safest — fails
   loudly if a file has since diverged, instead of silently overwriting).
2. **Manual**: copy the files under `changed-files/` over your working tree,
   preserving paths.

Either way, run `pnpm install` again afterward (a few new files, no new
dependencies were added).

Verified: `pnpm run typecheck` on both `@workspace/api-server` and
`@workspace/sikka` produces **zero new errors** versus the pre-change baseline
(confirmed by diffing error lists before/after, not just "it ran"). The
repo already had ~30 pre-existing backend typecheck errors and ~6 pre-existing
frontend ones (Clerk typing mismatches, a couple of scripts) — those are
untouched and not mine to silently "fix" as part of this. What I could **not**
verify from here: an actual Gradle/Android build, or on-device rendering. Both
need a real check on your end before shipping.

---

### 1. Trip notification redesign — done, needs a device check
- Rebuilt as a RemoteViews layout (`notification_trip.xml` / `_ar.xml`)
  instead of a hand-painted bitmap, so text renders in real Cairo font files
  (bundled under `res/font/`, pulled from `@fontsource/cairo`, OFL-licensed)
  at real sizes, matching the pill/circle layout in Group_5.svg.
- Left circle: your logo (from `IMG-20260507-WA0015_1.png`), static.
- Right circle: dynamically tinted to the current leg's real line color,
  showing a localized mode label ("Bus"/"Microbus"/"Metro"/...) — **not** a
  route number like the "84" in the reference image. Flagging this
  explicitly since it's a real deviation from the literal reference: if you'd
  rather it show the actual route/line number/code, that's a small change
  (swap `modeLabelFor(currentSeg)` for `currentSeg.line_number` in the
  `useTripNotification` call in `Index.tsx`) — say the word and I'll flip it.
- **Bug fixed along the way**: the native plugin was fully built but never
  actually called — `useTripNotification` was only posting to a service
  worker, so none of this custom layout could have shown up before. Now
  wired: native platforms get the real native notification, web/PWA keeps
  the service-worker path.
- Rendered a mock of the actual layout with your actual bundled fonts/logo to
  sanity-check it (not just eyeballing the XML) — English and Arabic both
  check out. Still can't compile the Android side or see it in a real
  notification shade from here, so a device check is the last mile.

### 2. Mini map when app is closed — not started
Flagging this honestly rather than guessing: a truly floating live map while
the app is fully closed needs Android's `SYSTEM_ALERT_WINDOW` overlay
permission, which Play Store scrutinizes heavily for non-accessibility apps
and can get a listing flagged for review. The safer, standard pattern (what
Google Maps itself does when backgrounded) is a richer *notification* with a
live map snapshot, not a floating window. Given how much else was in this
batch, I didn't want to guess at which one you actually want and build the
wrong one — let me know which direction and I'll build it next.

### 3. Monorail — flag-only fix, no route data touched
Per your instruction, I treated this as strictly off-limits for route data.
What changed:
- `graph.ts`: a line only gets synthetic "board anywhere" points if
  `has_fixed_stops` is false. Monorail's *seeding code* (`seedCairo.ts`)
  already sets this correctly — so if the bug is still showing up for you,
  it's stale data from before that logic existed, not a code bug.
- Added `POST /api/admin/fixed-stops-repair?transportType=Monorail` — flips
  `has_fixed_stops` to `true` for existing Monorail rows only. It touches
  *that one boolean column* and nothing else — not route_path, not stops,
  not names, not coordinates, not ordering. `GET` the same URL first for a
  dry-run preview (shows exactly which lines would change, changes nothing).
- I did **not** add or edit any monorail station data. If the live rows are
  missing real intermediate stations (as opposed to just having the flag set
  wrong), that's a data gap I can't respons­ibly fill by guessing coordinates —
  it'd need real official station data.

### 4 & 8. Mandatory dialogs — done
- Added an opt-in `hideClose` prop to the shared `DialogContent` (default
  off, so every other dialog in the app is unaffected).
- Microbus/Bus "used" dialogs: removed the Skip button, hid the X, made
  backdrop-tap/Escape no-ops.
- "I rode an unknown transport" dialog: removed Cancel and X, removed the
  GPS-quality picker and the direction-confirmed toggle (direction is now
  always taken as whatever GPS actually recorded — nothing to confirm).
  On scope ("only for bus/microbus, not anything else"): this dialog is
  already only reachable via the manual recorder or the background-discovery
  flow, both bus/microbus-oriented by design — and turning off always-on
  background discovery (#11) removes the one path that could occasionally
  misfire on non-bus/microbus movement, so this is now tighter as a side
  effect of that change too.

### 5. Auto-trigger arrival — done, scoped to bus/microbus
GPS proximity to a segment's end (reusing the existing 120m threshold) now
auto-opens the Used dialog for bus/microbus without waiting for a manual "I
arrived" tap. Left every other mode (metro/train/walk/taxi/monorail) on the
manual flow — auto-advancing those felt riskier (e.g. a multi-stop train)
and wasn't explicitly asked for, but easy to extend if you want it broader.

### 6. Focus button — done
Repositioned from `bottom-40` to `bottom-52`, and now uses the exact same
classes/variant/size as the profile button (just swapped the icon and
kept the recenter behavior).

### 7. Map detail — one real bug fixed
Found that "bright" mode was silently aliased to "positron" (OpenFreeMap's
deliberately POI-stripped minimal style) instead of its own actual "bright"
style — fixed. Your default ("standard") mode was already on "liberty",
OpenFreeMap's most detailed style, so that part was already right; also
bumped default zoom 14→15 so labels/POIs actually render instead of just
roads.

### 9. Location-enable flow — done
Checks the fast local "is location enabled" flag first instead of waiting on
a `getCurrentPosition` timeout. Shows a short "Turning on your location…"
state with a bottom-border linear gradient bar, auto-polls every 1.5s
(2 min cap) until location is actually on, then proceeds automatically —
no more close-and-reopen needed.

### 10. Prefer accepted discovered routes — done
`dataSource`/`routeStatus` were tracked in the DB but never read by the
engine at all. Wired them through `graph.ts` → `planner.ts` → `score.ts`,
and added a modest scoring bonus for legs on a `dataSource: "discovery"` line
once it's `routeStatus: "active"` (i.e. reviewed and accepted) — enough to
win close calls/ties, not enough to override a genuinely faster/cheaper plan.

### 11. Pinned discovery notification — removed, with a real tradeoff
Android requires *some* persistent notification for any foreground service
doing background location — there's no supported way to keep always-on
background ride detection running with zero notification. So: turned off the
always-on background service entirely (added a real `stopAlwaysOn` native
method and call it, including for installs where it's already running).
The notification is gone. The tradeoff: ride discovery now only happens while
Sikka is actually open, not when the phone's locked or the app's closed. If
you'd rather keep background detection and just want a quieter/less frequent
notification, that's a different, smaller change — let me know.

### 12. Trains / intercity / taxi
- **Taxi chooser**: built a real Uber/Careem picker (`TaxiAppButton` +
  `taxiApps.ts`) and used it in both places that had the Uber-only hardcode
  (in-trip button, and the standalone `/travel/taxi` page).
- **Arabic search bug — found and fixed**: `intercitySearch.ts`'s text
  normalizer stripped every non-a-z0-9 character, so any Arabic query
  normalized to an empty string and could never match. Also fixed
  `findCity` to actually check the Arabic name field, which it never did.
- **Governorate-to-governorate picker**: replaced the city-level pickers in
  both Intercity and Train search with governorate pickers (new
  `GET /api/intercity/governorates`), for both from and to. Each governorate
  maps to a representative hub city under the hood for the actual operator
  search — shown transparently in the picker ("Searches via Sharm El-Sheikh")
  rather than hidden. Also removed the hardcoded "defaults to Cairo" (or
  nearest-to-current-GPS) origin behavior you flagged.
- **Trains**: kept the existing self-hosted timetable API rather than
  building a live scraper against ENR's booking backend — the pasted spec
  document's endpoint isn't something I could verify is real/stable from
  here, and scraping a booking flow that needs an Egyptian national ID is
  exactly the kind of thing worth being cautious about. Added the "Open ENR
  website" link (to the exact URL you gave) for Egyptian accounts, and for
  foreign accounts (using the `nationality` field that already existed on
  profiles) a plain "go to the station" instruction instead of a booking
  link they can't use.
