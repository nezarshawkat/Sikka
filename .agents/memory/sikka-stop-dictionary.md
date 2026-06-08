---
name: Sikka stop dictionary & route_path corruption
description: Why rail station coordinates are curated, not derived, and how the stop-dictionary import handles corrupted source geometry
---

# Sikka stop dictionary import

The stop dictionary (`locations` + `mawaqef` + microbus `transport_heatmaps`) is
built by `artifacts/api-server/src/utils/importStopsDictionary.ts`
(`runStopImport()`), exposed admin-only at `POST /api/admin/seed-stops` and via
CLI `pnpm --filter @workspace/api-server run seed:stops`. It is idempotent
(full delete+reinsert in one transaction).

## Key durable lesson: route_path geometry is partly corrupted
The `transit_lines.route_path` polylines are the only in-DB coordinate source,
but many stops failed geocoding when the data was first generated and were all
snapped to a single downtown fallback point (~[31.2418, 30.0470]). Verified
rail termini derived from this geometry came out 10+ km off or collapsed.

**Why:** any dictionary derived purely from route_path inherits these wrong
coordinates, which would degrade routing rather than help it.

**How to apply:**
- Rail stations (Metro L1–3 + Monorail) get authoritative coordinates from the
  curated `artifacts/api-server/src/utils/railStations.ts` table (keyed by the
  same station names the line data uses, reconciled via `normalizeName`). Never
  derive rail station coords from route_path.
- Non-rail bus/serfis/microbus areas keep best-effort derived coords (those
  routes are board-anywhere, so point precision matters far less).
- A 5-decimal `coordKey` blacklist drops any coordinate shared by ≥3 distinct
  stop keys (synthetic geocoder fallbacks); affected stops are skipped, never
  placed at a fake location.
- A name that is both rail and non-rail is treated as rail (gets the curated
  coord, no `mawaqef` row).
- If you ever add governorates beyond Cairo, scope the delete/rebuild by
  city/governorate — the current import wipes the whole dictionary.
