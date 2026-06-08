---
name: Applying external zip snapshots to Sikka
description: How to safely apply the user's full-file zip snapshots (Codex/GitHub-generated) into Sikka without regressing the MapLibre migration or leaving dead-end routes
---

# Applying external zip snapshots into Sikka

The user periodically drops `attached_assets/edited-files_*.zip` containing FULL-FILE snapshots (Windows backslash paths). `unzip` is not installed — extract with `python3 -c "import zipfile..."`, normalizing `\\` → `/`.

## Map-renderer gate (the recurring rule)
The project renders maps with **MapLibre GL**, but still keeps `mapbox-gl` as a dep and legitimately uses Mapbox's **geocoding REST API** (`api.mapbox.com`) plus `.mapboxgl-` CSS compat classes (MapLibre keeps those class names). So a raw `grep -i mapbox` is too blunt.

**How to apply:** classify each file by what it actually imports:
- `from 'react-map-gl/mapbox'` or `import 'mapbox-gl'` → Mapbox RENDERER → would regress the migration → skip.
- `maplibre` imports, `api.mapbox.com` geocoding, `.mapboxgl-` CSS → matches current code → safe to apply.
Confirm the candidate files match the patterns already present in the current `Index.tsx`, `TripResult.tsx`, `LocationAutocomplete.tsx`, `PlanSetup.tsx`, `index.css` before applying.

**Why:** earlier zips were OLD pre-migration versions whose `Index.tsx` imported `react-map-gl/mapbox` and would have reverted MapLibre. Newer zips were regenerated to MapLibre and are safe.

## Router wiring is NOT in the zips
These zips omit `App.tsx`. When a snapshot adds a new page (e.g. `TravelMode.tsx`) and other files navigate to it (e.g. `Index.tsx` → `/travel/:mode` for train/flight/taxi/nile choices in `IntercityChoiceDialog`), you MUST register the route in `App.tsx` yourself or the choice dead-ends at NotFound. Always grep new `navigate(...)` targets against `App.tsx` routes after applying.

## Validation note
`tsc` has long-standing PRE-EXISTING errors in untouched files (`Auth.tsx`, `SignIn/SignUp.tsx`, `AdminMap.tsx`, `AdminRoutes.tsx`, `transportTypes.ts`, `seedDirect.ts`). Dev build uses esbuild (no typecheck), so these don't block runtime. After applying, confirm the errors are only in files you did NOT touch, then restart api-server (build-then-run, no watch) and check browser/HMR for real errors.

## CRLF line endings (Windows zips)
Files in these zips have **CRLF** line terminators. The `read` tool strips `\r`, so `edit` old_string matches silently FAIL (the file has `\r\n`, your copied string has `\n`). After applying, run `sed -i 's/\r$//' <file>` on every applied file to normalize to LF (the codebase convention) BEFORE attempting any `edit`. Detect with `file <f>` ("with CRLF").

## Genuine syntax errors in zip code must be fixed
Codex zips can contain real JS parse errors (e.g. `a ?? b || c` mixed without parens → TS5076, a hard esbuild parse failure). Unlike logic quirks (which you flag, not change), a parse error breaks the build for that module — fix it minimally with parens, preserving intent. This is the same class as the missing-route gap: an objective break, not an opinion.
