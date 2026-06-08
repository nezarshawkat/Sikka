---
name: Sikka glass-panel styling
description: How the .glass-panel component works and two non-obvious pitfalls when changing its opacity
---

# Sikka `.glass-panel` (artifacts/sikka/src/index.css)

`.glass-panel` is defined TWICE in index.css (a base `@apply` def and a richer one that
adds a `background-image` linear-gradient + custom box-shadow, plus a `.dark` variant).
The visible fill is the gradient; `background-color` is set to `transparent` so the gradient
alpha controls see-through.

INTENTIONALLY TRANSLUCENT (frosted glass): light gradient ~`hsl(var(--card)/0.6 → 0.42)`,
dark ~`0.52 → 0.32`, with `backdrop-filter: blur(22-24px) saturate(~180%)`. Do NOT bump it
back toward opaque (e.g. 0.92) — that kills the glassmorphism the user explicitly wants.
The glass effect is only VISIBLE where a panel overlays content (e.g. the home search bar
over the Mapbox/maplibre map); over a plain page background it just looks lightly tinted.

## Pitfall 1 — Tailwind JIT opacity literals
`@apply bg-card/92` FAILS at build (postcss: "the `bg-card/92` class does not exist").
Tailwind v3 JIT only generates `bg-card/<N>` for opacity values that appear *literally*
in scanned content. `/75` and `/82` worked only because those literals existed elsewhere
in `.tsx`. For arbitrary opacity in `@apply`, use bracket syntax: `bg-card/[0.92]` — always
generated.

## Pitfall 2 — utility classes override .glass-panel
Many components combined `glass-panel` WITH a `bg-card/82` (or `bg-background/..`) utility on
the same element. Because Tailwind utilities layer AFTER components, the utility's
background-color overrides `.glass-panel`'s, weakening the intended opacity. To make a
glass surface honor its designed opacity, REMOVE the conflicting `bg-card/<N>` utility and
let `.glass-panel` provide the background.

**Why:** A request to "make glass more opaque" by bumping the component's opacity has no
visible effect on elements that also carry a `bg-card/<N>` utility — you must strip the
utility too.
**How to apply:** `grep "glass-panel" --include=*.tsx | grep "bg-card/"` to find conflicts.
DiscoverTrip's unselected-mode `bg-card/70` is intentional (lighter look) — leave it.
