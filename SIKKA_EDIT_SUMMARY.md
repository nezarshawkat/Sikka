# Sikka edit package

Extract this ZIP into the root of the Sikka repository and allow it to
overwrite the matching files. The paths inside the archive already begin with
`artifacts/`.

## Included edits

- Location is checked before the enable-location prompt is shown.
- On Android, a denied location request can open Sikka's system app-settings
  page through a registered Capacitor plugin.
- Walking uses free OSRM foot routing; taxi and tuktuk use free OSRM car routing.
  Connector geometry is cached locally and does not query the Sikka database.
- Trip Review defaults to Comfortable and leaves the budget field empty.
- When metro/monorail is possible, exactly one comparison option is assigned
  the rail route (when non-rail alternatives exist). The label is chosen
  dynamically from Recommended, Cheapest, Fastest, or Fewest Transfers based on
  which objective the rail candidate fits best. That card is highlighted and
  initially selected as the top recommendation.
- Route Detail includes single-route path regeneration for eligible
  bus/microbus/serfis geometry. Fixed rail and rider-recorded Discovery GPS are
  protected from synthetic replacement.
- Discovery loading tolerates one failed endpoint and rejects malformed GPS
  coordinates instead of collapsing the page.
- The frontend snapshot schema expectation now matches the bundled/API schema.

## CSV street-accuracy proposal (not implemented in this ZIP)

1. Treat ordered CSV stops as constraints, not as the final geometry.
2. Prefer coordinates supplied in the CSV or the maintained stop dictionary;
   geocode only missing stops and cache the result once during import.
3. Generate multiple paths between consecutive anchors against a locally run,
   free Egypt OpenStreetMap graph (OSRM or Valhalla), with bus/microbus road-class
   rules. Do this at import/regeneration time, never during a rider trip.
4. Score candidates using stop distance, endpoint preservation, direction,
   backtracking, path-length ratio, road class, geometry jumps, and agreement
   with GTFS/Discovery GPS.
5. Automatically accept only a high-confidence path. Send uncertain lines to
   an admin map for waypoint correction; never silently publish a guess.
6. Save the accepted `route_path` once and export it into the versioned offline
   snapshot. Trip planning then reads the snapshot on-device with no per-trip DB
   request.

## Verification performed

- Backend production esbuild completed successfully.
- Every edited TypeScript/TSX file passed esbuild parsing.
- Live OSRM car and foot endpoints returned valid multi-point geometry.
- Full frontend Vite launch on this Windows machine was blocked by the existing
  workspace override that excludes Rollup's Windows native package.
- Android Java compilation requires a configured JDK/JAVA_HOME, which was not
  available in this environment.
