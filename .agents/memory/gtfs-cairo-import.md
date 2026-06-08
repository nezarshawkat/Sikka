---
name: GTFS Cairo import
description: How the authoritative Transport-for-Cairo GTFS feed is vendored and imported into Sikka transit_lines
---

# GTFS Cairo import

Sikka's transit data was migrated to the authoritative Transport-for-Cairo GTFS feed
(GCR Digital Cairo 2017, `20180906_GTFSfullworking_Bus_Metro` — has metro + bus,
217 routes, real `shapes.txt` geometry).

- **Vendored data, not raw CSVs.** The feed is extracted once into a compact JSON that
  esbuild inlines. **Why:** raw `shapes.txt` is 5MB+; runtime must not parse CSVs nor
  depend on `/tmp` clones. To refresh, re-extract from the cloned feed (one representative
  trip per route, prefer direction_id=0).
- **Run it via the bundled build script, not the HTTP route, in dev.** The admin endpoint
  needs Clerk admin auth which is impractical locally; the script defaults to dry-run and
  needs an explicit apply flag.
- **Metro = full replace; buses = insert + keep + dual-number merge.**
  **Why:** user rule is "remove old data GTFS covers, keep buses we have that GTFS does
  NOT cover, and if a bus exists in both under different numbers store BOTH numbers."
  Metro is fully covered so its lines are deleted/replaced; bus/serfis/microbus lines are
  inserted alongside existing ones, and existing non-covered lines are kept.
- **Merge is geometry-based (endpoint proximity ≤1.5 km, either orientation), NOT name-based.**
  **Why:** existing lines are Arabic CSV data, GTFS is English with coded what3words stop
  ids — cross-language name matching is unreliable; some existing `route_path` is also
  corrupt. In the 2018 feed the GTFS bus routes cover satellite cities (6th October,
  10th Ramadan, New Cairo) whose nearest legacy central-Cairo line is 2.5–34 km away, so
  zero merges occur — that is correct, not a bug. If a future feed overlaps central Cairo,
  merges will fire and write `"<gtfs#> / <old#>"` into `line_number`.
- **"Appears on map" is automatic:** `AdminMap` renders every line's `route_path`; the
  routing engine consumes `route_path` for trip legs. Engine falls back to shape-point
  coords when a fixed-stop name isn't in the locations dictionary, so metro routing works
  even for GTFS station names not previously seeded.
