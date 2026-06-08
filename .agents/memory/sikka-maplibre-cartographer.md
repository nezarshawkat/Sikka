---
name: Sikka maplibre route lines vanish (cartographer + react-map-gl)
description: Why declarative react-map-gl <Source>/<Layer> drops layers in dev, and the imperative fix
---

# react-map-gl <Source>/<Layer> JSX silently drops map layers in dev

In Sikka, trip route LINES did not draw (only start/end markers showed) while the
basemap rendered fine. Markers are DOM overlays so they always show; the line is a
WebGL layer that never got added.

**Root cause:** `@replit/vite-plugin-cartographer` (dev-only Vite plugin) injects
`data-replit-metadata` and `data-component-name` attributes onto EVERY JSX element,
including react-map-gl v8's `<Source>`/`<Layer>` components. react-map-gl forwards
unknown props into the maplibre source/layer spec, and maplibre's strict validator
rejects the whole source: `sources.<id>: unknown property "data-replit-metadata"`.
The error is swallowed as maplibre's default `console.error(errorEvent)`, which
serializes to `[{}]` in the console — so the real message is invisible until you add
an `onError` handler to `<Map>` that logs `e.error?.message`.

**Why:** only happens in dev (cartographer is gated on `NODE_ENV !== production` &&
`REPL_ID`). A production build would draw the line, masking the dev-only break the
user actually sees in the Replit preview.

**Fix / how to apply:** do NOT add map sources/layers via react-map-gl JSX in this
project. Add them imperatively via `useMap()` -> `map.addSource/addLayer` with plain
object literals (cartographer only transforms JSX, not object literals). See
`artifacts/sikka/src/components/RouteLayers.tsx` (line + label layers, re-adds on
`styledata` for light/dark style swaps, `setData` on data change, cleanup on unmount).
Used by `Index.tsx` (home map) and `TripResult.tsx`.

**Still latent:** `AdminMap.tsx` (routes/drawing/heatmap sources) and `Intercity.tsx`
still use JSX `<Source>`/`<Layer>` and have the identical defect — their overlays will
not draw in dev until migrated to the imperative pattern.
