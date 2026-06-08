---
name: Intercity aggregator architecture
description: Key decisions for the Egypt Intercity Transport Aggregator backend+frontend
---

## Architecture
- Backend adapters live in `artifacts/api-server/src/adapters/` (superjet.ts, gobus.ts, bluebus.ts)
- Search orchestrator: `artifacts/api-server/src/lib/intercitySearch.ts`
- Route handler: `artifacts/api-server/src/routes/intercity.ts` — wired BEFORE `clerkAuth` middleware so it's public
- DB cache table: `inter_trips_cache` (15-min TTL, cacheKey = "from|to|date")
- City list: hardcoded in `intercityTypes.ts` (30 Egyptian cities with lat/lng)
- Operator list: hardcoded in the route file (SuperJet, GoBus, BlueBus)

**Why:** External operator APIs are rate-limited and sometimes require scraping — caching in DB prevents hammering them and speeds up repeated searches.

**How to apply:** When adding a new operator adapter, add it to `intercitySearch.ts` runIntercitySearch(), the OPERATORS const in intercity.ts, and the DESIGN brief if rebuilding the frontend.

## Frontend
- Artifact: `artifacts/intercity` (wouter, Tailwind v4, shadcn)
- Pages: `/` (search + featured routes) and `/results` (trip cards + filter bar)
- Design: blue hero (#3b5bdb-ish), white card results, operator-colored badges
- All city data fetched live from `useListInterCities`

## Adapter behavior
- All adapters gracefully fall back to mock trips when the external API is unreachable
- SuperJet: Cheerio HTML scraping of form + trip HTML (brittle — check first when broken)
- GoBus: REST JSON at /api/getTrips (most stable)
- BlueBus: GraphQL at api.bluebus.com.eg/graphql
