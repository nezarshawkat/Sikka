# Sikka update — Discovery page fixes + offline/background contribution

5 files. Apply at repo root. No DB migration needed this time.

## 1-3. Discovery page layout
- Restored the "Discovery learning brain" instructions card that was dropped
  in the previous rewrite.
- Removed the page's own header (back button + "Discovery" title) — the
  parent AdminDashboard already provides one consistently across all admin
  pages, so this was redundant and inconsistent.
- Removed the extra padding wrapper that was making the page's content area
  narrower than sibling pages (AdminRoutes, etc.) — now uses the exact same
  `space-y-4` root pattern as those.

## 4. Contribution now survives the app being closed/offline
Two separate things bundled into "closed or offline":
- **Offline at submit time** — turns out this already worked: `api.ts` has
  an existing offline queue that auto-retries POSTs to `/transport-reports`
  when the network is down, and flushes on reconnect/app-open. No changes
  needed there.
- **App closed mid-recording** — this was the real gap. The JS-side GPS
  watcher only runs while the page is open. Fixed by starting the same
  native durable recorder trip-discovery already uses (a real Android
  foreground service, state persisted to disk after every fix) as a safety
  net whenever manual "Contribute a route" recording starts, and restoring
  it to whatever state it was in before once you stop. Also added overlap
  suppression so a trip you explicitly recorded doesn't also generate a
  duplicate "did you take a bus?" prompt later from the same physical trip.

## 5. Enlarged map on tap
Small map inside each discovery card is now tappable — opens a bigger,
interactive dialog with the same route (and the same multi-contributor
color blending) to actually inspect it.

## Your new messages
**"Always thanks, no errors"** — done. Backend/GPS-quality rejections
(impossible jump, couldn't road-match, etc.) are no longer shown to the
contributor at all — they always see "Thanks for contributing!" The data
is still safely saved server-side as a reviewable rejected route either
way, so nothing is lost, it's just not the rider's problem to troubleshoot.
Only genuine form mistakes (missing required fields) still show an error —
those you can actually fix by typing something.

**Toast behind the dialog** — fixed: the toast layer now renders at a very
high z-index so it always sits above any open dialog.

**Missing field turns red** — done, on the bus number field and the
destination field (both display and input variants), clearing automatically
once you fix it.

**Autofill destination for full routes** — done. Same reverse-geocoding
approach as the boarding point: when "Full route" is selected, the
destination auto-resolves from the trace's last point and becomes read-only,
same as the boarding point already was. Switching to "Partial route" reverts
it to a manual field, since a partial trip's recorded end isn't necessarily
the real route terminus.

**Removed the "Microbus route number or windshield sign (optional)"
field** — done, gone entirely.

## Routing-service configuration

Nothing needs to be entered for a basic deployment: leave both variables
blank and discovery uses the built-in OSRM public-service failover. That is
free, but it is best-effort and not suitable as the only dependency for a
busy production service.

For dependable production road matching, deploy one of the open-source
routers and put its base URL in Render:

- `OSRM_DRIVING_URL=https://osrm.example.com` — the URL must expose
  `/match/v1/driving`. Do **not** append `/match` or `/route` to the value.
- `VALHALLA_URL=https://valhalla.example.com` — the URL must expose
  `/trace_route`. Do **not** append `/trace_route` to the value.

OSRM and Valhalla are free, open-source software; neither requires an API key
or a paid account. They are not hosted by this repository, however, so a
self-hosted deployment still has normal server and map-data storage costs.
Valhalla is optional: when it is blank or unreachable, both profile
contributions and trip discovery automatically use OSRM instead. Likewise,
the admin retry controls fall back to the other provider if the selected one
is unavailable.

### Recommended hosted fallback: Google Roads

Public OSRM instances are demos and can reject or rate-limit server traffic.
If that is happening, create a **server-restricted** Google Cloud API key,
enable the **Roads API**, and set `GOOGLE_ROADS_API_KEY` in Render. The
backend uses its Snap to Roads service only after OSRM fails, for both profile
contributions and trip discovery. This is an authenticated paid Google API,
so configure a billing budget; do not use the Android Maps SDK key or expose
this key through a `VITE_` variable.
