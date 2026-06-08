---
name: Sikka frontend map stack
description: Which map library/tiles the user-facing frontend uses and what Mapbox usage still remains
---

# Sikka frontend map

Frontend GL map rendering uses **MapLibre** (`react-map-gl/maplibre`) with **keyless OpenFreeMap** vector styles (light/dark constants live in `useIsDark.ts`). No Mapbox access token is needed to render maps.

**Why:** user wanted the frontend free of Mapbox token/cost limits; OpenFreeMap is free and needs no API key.

**How to apply:**
- Render maps via `react-map-gl/maplibre` only; do not reintroduce `react-map-gl/mapbox` or `mapboxAccessToken`.
- Symbol `text-font` must be a font present in OpenFreeMap glyphs (e.g. `Noto Sans Bold`); Mapbox fonts like `DIN Pro Bold` silently fail to load.
- User-facing trip maps render the backend per-segment geometry directly as raw polylines — never call a client-side directions/snapping API; fall back to a straight line when geometry is missing.

**Still on Mapbox (intentionally, until a later step):** geocoding REST (location autocomplete + reverse-geocode) and the admin authoring snap/geocode tools. Treat these as the remaining Mapbox surface when "remove Mapbox entirely" comes up.

**Testing gotcha:** the Playwright test browser has **no WebGL**, so any MapLibre/Mapbox map renders blank there and `runTest` reports "Failed to initialize WebGL". This is environmental, not a bug — verify map structure/overlays instead of canvas pixels.
