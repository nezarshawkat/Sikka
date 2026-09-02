# Intercity API Audit

## Scope and research status

This audit covers the intercity transportation integrations currently present in the repository and the way they are modeled in Sikka.

The project currently contains these intercity-related surfaces:

- Bus adapter layer: `artifacts/api-server/src/adapters/superjet.ts`, `gobus.ts`, `bluebus.ts`
- Orchestration layer: `artifacts/api-server/src/lib/intercitySearch.ts`
- Mapping layer: `artifacts/api-server/src/lib/intercityOperators.ts`
- Data model and city catalog: `artifacts/api-server/src/lib/intercityTypes.ts`
- Public API routes: `artifacts/api-server/src/routes/intercity.ts`
- Train data: `artifacts/api-server/src/routes/trains.ts` and `artifacts/api-server/src/data/egyptTrainsSeed.json`
- Frontend intercity UI: `artifacts/sikka/src/pages/Intercity.tsx`
- DB schema: `lib/db/src/schema/intercity.ts`

This repository does not contain a verified real-world flight provider integration. The flight option is still treated as a selection-only UX path and not as an actual live flight-search API adapter.

---

## 1) Provider inventory

### 1. SuperJet
- Provider/company: SuperJet
- Transportation type: Intercity bus
- Official website: https://www.superjet.com.eg
- Existing API/base URL: `https://www.superjet.com.eg`
- Search flow: Booking form submission to `/booking/getTrips`
- HTTP method: POST
- Required parameters: `FromCity`, `ToCity`, `DateFrom`, `Adults`, `ReturnTrip`
- Endpoint details: request is form-encoded (`application/x-www-form-urlencoded`)
- Authentication: none exposed in code; site likely uses cookie/session for form handling, but this repo does not require a token
- Cookies/session requirements: form page may set site cookies; not explicitly modeled here
- Request body and search semantics: uses internal city IDs from the SuperJet booking form, not the app’s own global city IDs
- Response structure: HTML page scraped with Cheerio; the adapter expects trip rows and selectors like `.trip-row`, `.trip-item`, and `[class*='trip']`
- Origin/destination representation: provider-specific city IDs from the live SuperJet dropdown; not the app’s `cairo`/`alexandria` IDs
- Date format: `YYYY-MM-DD`
- Passenger parameters: `Adults=1`
- Current failure reason: previously passed the app’s internal IDs directly; the repo also previously had fake fallback trip generation. The live site’s selector contract was not verified in the sandbox.
- Current usability: potentially usable if city IDs are resolved from the live dropdown and selectors still match the site
- What needs to be scraped again: live SuperJet city dropdown values and response markup if the site changes

### 2. GoBus
- Provider/company: GoBus
- Transportation type: Intercity bus
- Official website: https://www.go-bus.com
- Existing API/base URL: `https://www.go-bus.com`
- Search flow: GET `/api/getTrips` with query parameters
- HTTP method: GET
- Required parameters: `from`, `to`, `date`
- Required headers: `User-Agent`, `Accept: application/json`
- Authentication: none in code
- Cookies/session requirements: none visible in code
- Request body: none
- Response structure: JSON list or nested `trips`/`data` array; each trip is normalized from `departureTime`, `arrivalTime`, `duration`, `price`, `availableSeats`, etc.
- Origin/destination representation: provider city strings, resolved by app mapping from a global city to the operator city label
- Date format: `YYYY-MM-DD`
- Passenger parameters: not exposed in code; default is the operator’s web search behavior
- Current failure reason: no fake fallback is allowed anymore; a failure returns empty results instead of invented data
- Current usability: likely the most stable of the three since the adapter is simple JSON-based
- What needs to be scraped again: if the API contract changes, the response field mapping needs verification against live output

### 3. BlueBus
- Provider/company: BlueBus
- Transportation type: Intercity bus
- Official website: https://www.bluebus.com.eg
- Existing API/base URL: `https://api.bluebus.com.eg/graphql`
- Search flow: GraphQL query `SearchTrips($from: String!, $to: String!, $date: String!)`
- HTTP method: POST
- Required parameters: GraphQL variables `from`, `to`, `date`
- Required headers: `Content-Type: application/json`, `User-Agent`
- Authentication: none in code
- Cookies/session requirements: none visible in code
- Request body structure: GraphQL document with `query` and `variables`
- Response structure: `res.data.data.trips`
- Origin/destination representation: city strings passed to GraphQL query
- Date format: `YYYY-MM-DD`
- Passenger parameters: none in code
- Current failure reason: GraphQL schema and selectors were once guessed; there are no fake result fallbacks anymore
- Current usability: not yet proven against a live environment in this sandbox; could work if the schema still matches
- What needs to be scraped again: confirm the real GraphQL fields and route semantics against the live API

### 4. Egyptian National Railways / seeded train catalog
- Provider/company: Egyptian National Railways (seeded timetables)
- Transportation type: Intercity train
- Official website: not a live web API, but the project uses a seeded real-data timetable dataset
- Existing data source: `artifacts/api-server/src/data/egyptTrainsSeed.json`
- Search flow: route matching by `fromCity` and `toCity`, stop order, and train numbers in `src/routes/trains.ts`
- HTTP method: GET via route handlers, not external network API
- Required parameters: from, to or train number
- Response structure: static seeded objects with `trainNumber`, `trainType`, `fromCity`, `toCity`, stops, operating notes
- Origin/destination representation: city names that resolve against `EGYPT_CITIES`
- Date format: not live-search based; timetable data is not date-dependent in the current repo
- Current failure reason: not a live provider API; the system is seeded and route-based rather than real-time availability search
- Current usability: usable as a local rail timetable dataset, not an actual booking API
- What needs to be refreshed: additional real timetables or route summaries if more coverage is required

### 5. Flight / plane provider
- Provider/company: none confirmed in the repository as a live provider adapter
- Transportation type: Air travel
- Existing code: simple flight option gating in the UI, not a live flight search implementation
- Official website: no live provider adapter was found
- Current usability: not implemented as a real provider; no live API or booking endpoint was evidence-backed in this codebase

---

## 2) Reverse-engineering findings by provider

### SuperJet
The app does not pass the user-facing city name into SuperJet directly. Instead, it resolves a real SuperJet city list from the live booking page and matches names to internal IDs, then only calls the API when both ends resolve.

The key logic is in:

- `artifacts/api-server/src/lib/intercitySearch.ts`
- `artifacts/api-server/src/adapters/superjet.ts`
- `artifacts/api-server/src/lib/intercityOperators.ts`

This is the correct design because the app’s internal city IDs and the operator’s city IDs are different namespaces. A direct pass-through would always be wrong.

### GoBus
GoBus is the simplest provider. It accepts a `from`, `to`, and `date` via a JSON API endpoint. The search is effectively a server-side query against its own route table.

The code in `gobus.ts` normalizes typical JSON fields such as `departureTime`, `arrivalTime`, `duration`, `price`, `availableSeats`, and station names.

### BlueBus
BlueBus uses a GraphQL endpoint instead of a REST endpoint. The search is a GraphQL document defined in `bluebus.ts`. This means the request body is not a plain object of form params or JSON search fields; it is a GraphQL operation string plus variables.

### Train data
Train data is not real-time search against a provider API but a seeded rail timetable dataset and route matcher. It is based on a curated list of major Egyptian rail lines and stop lists, with route summaries used when exact per-stop timetables are unavailable.

---

## 3) Why the code was broken before the fix

The prior failure mode was not a small typo; it was a systemic provider mismatch:

1. The app used its own internal city IDs (`cairo`, `alexandria`, etc.) as if they were provider IDs.
2. Different operators use completely different identifier spaces.
3. Some adapters silently fabricated trip times and prices when requests failed.
4. The code had no real provider-specific mapping layer and no honest zero-result handling.
5. The frontend treated governorates as both user-facing labels and provider API inputs; this is a layering bug.

The repo’s newer code addresses the most important root causes by:

- resolving provider-specific city names before calls
- only querying a provider when valid provider-specific mappings exist
- returning empty arrays on provider failure instead of fake trip data
- separating the user-facing governorate list from provider search IDs

---

## 4) Design of the correct mapping architecture

The important rule is:

- User input: governorate / city name
- Internal app model: a canonical Egyptian city record
- Provider search layer: provider-specific city name, station, city ID, code, or dropdown value

The repository already models this correctly in concept:

- `EGYPT_CITIES` defines the shared app-level location catalog
- `getOperatorCity()` resolves a city into the exact value used by the operator
- `runIntercitySearch()` calls each provider adapter with the correct mapping objects

This is the correct architecture. It avoids the anti-pattern of using a single global `fromId`/`toId` across all operators.

---

## 5) Data model and provider-specific identifiers

The shared database schema in `lib/db/src/schema/intercity.ts` is already aligned with the correct design:

- `inter_cities`: canonical global cities
- `inter_operators`: provider metadata
- `inter_operator_cities`: provider city mapping table
- `inter_stations`: operator station metadata
- `inter_trips_cache`: cached trip results

This is the correct place to persist provider mappings and avoid re-discovering them on every search.

---

## 6) Frontend/backend route flow

The runtime flow is:

1. User selects a city or governorate in the frontend UI.
2. Frontend calls `/api/intercity/search?from=...&to=...&date=...`.
3. Backend resolves the names to canonical global cities.
4. Backend resolves provider-specific mappings.
5. Each adapter performs its own search.
6. Results are normalized into an app-level trip object shape.
7. Results are sorted and returned to the frontend.

This matches the requirement that the provider-specific implementation lives behind a common orchestration layer instead of pretending every provider uses the same API contract.

---

## 7) Provider status summary

| Provider | Type | Status | Notes |
| --- | --- | --- | --- |
| SuperJet | Bus | Repaired / needs live verification | City-ID mapping fixed; no fake fallback remains |
| GoBus | Bus | Repaired / likely usable | JSON API path is straightforward |
| BlueBus | Bus | Repaired / needs live verification | GraphQL shape must be checked against current live API |
| Egyptian Railways (seeded) | Train | Working as local seed dataset | Not a live external API |
| Flight | Air | Not implemented | No verified live flight API found |

---

## 8) Current problems / limitations

The major remaining limitation is not in the app’s architecture, but in external provider verification. The sandbox environment cannot reach the live bus websites or verify their current HTML/JSON/GraphQL outputs, so the live API contract remains unproven from inside this environment.

The current repository does the right thing by avoiding invented data. It does not claim that every provider is live and confirmed; it fails empty rather than inventing schedules.

This is materially better than a fake-data integration, because it preserves honest failure and is debuggable.

---

## 9) Recommendation for future work

The next step, outside the sandbox, is to perform live operator verification against the real websites and then update the adapters if any field names or endpoint contracts differ.

Priority order:

1. Live SuperJet city ID list and trip HTML contract check
2. Live GoBus JSON field verification
3. Live BlueBus GraphQL schema verification
4. Add provider-specific test fixtures for each adapter
5. Add explicit route coverage data per provider where the operator does/does not serve a city pair

---

## 10) Final conclusion

The codebase already contains the correct architectural direction for a provider-specific intercity bus and rail system:

- canonical app-level city catalog
- operator-specific mapping
- provider-specific adapters
- honest no-result behavior
- database tables for persistent mappings and cache

The main unresolved issue is live API verification against external websites, not the internal app architecture itself.
