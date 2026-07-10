# Greater Cairo Road Route Study Apply Notes

This package updates the Greater Cairo road-transit seed after a Google Directions-backed study.

## What changed

- Replaced `BRT-1` with the official Cairo Ring Road phase-1 station order.
- Stored a Google Directions Ring Road geometry for BRT-1, with 14 fixed stations and station access/service details.
- Added `scripts/studyGreaterCairoRoadRoutesWithGoogle.mjs` to rerun the study without storing the API key in the repo.
- Repaired 5 microbus geometries that overlapped the BRT-only phase-1 Ring Road segment.
- Marked 12 unresolved microbus overlaps as `needs_review` because Google alternatives still overlapped the banned BRT segment.
- Changed the backend prepared-seed apply script so confirmed replacement updates existing `route_path` values and preserves `needs_review`.

## Files to inspect

- `scripts/generated/greater-cairo-road-transport-study.json`
- `scripts/generated/cairo-brt-phase1-google-route.json`
- `scripts/generated/greater-cairo-microbus-brt-ban-repairs.json`

## Apply in Codespace

From the repo root:

```bash
unzip -o sikka-greater-cairo-brt-road-study.zip
corepack enable
pnpm install
pnpm --filter @workspace/api-server run build
node artifacts/api-server/dist/scripts/applyPreparedDeviceRouteSeedToBackend.mjs --validate-only
node artifacts/api-server/dist/scripts/applyPreparedDeviceRouteSeedToBackend.mjs --confirm-replace
```

The last command uses your configured backend database environment. It replaces the old route data with `scripts/generated/prepared-device-route-seed.json`.

## Rerun the Google study

```bash
export GOOGLE_DIRECTIONS_API_KEY="your-key"
node scripts/studyGreaterCairoRoadRoutesWithGoogle.mjs \
  --apply \
  --regenerate-hard-microbus \
  --acknowledge-google-storage-license="your-permission-reference"
unset GOOGLE_DIRECTIONS_API_KEY
```

The API key is intentionally not stored in this package.
