# Sikka — Cairo & Egypt Transit App
### A-to-Z Overview (for management / stakeholder discussion)

*Last updated: June 2026*

---

## 1. Executive Summary (the one-paragraph version)

**Sikka** is a public-transport trip-planning app for Egypt. A rider enters where
they are and where they want to go, picks a budget style (cheap / balanced /
comfortable), and Sikka returns a **turn-by-turn journey** across real Cairo
transport — metro, train, monorail, public buses, *serfis* (shared vans),
microbuses, tuktuks, and taxis (Uber/Careem) — drawn on a live map, with the
**price, time, number of transfers, and crowding** for each leg. It also covers
**intercity travel** (e.g. Cairo → Alexandria) by pulling live bus options from
external operators. The single most important promise of the product: **Sikka
never invents a route.** Every step it shows you corresponds to a real, verified
transit line in our database — the directions are safe to follow on the ground.

---

## 2. What problem does it solve?

Getting around Cairo on public transport is hard for locals and nearly impossible
for visitors:
- There is **no single official map** of buses, serfis, and microbus routes —
  much of the network lives in people's heads.
- Google Maps has poor coverage of the **informal** modes (serfis, microbus,
  tuktuk) that most Egyptians actually use, and doesn't understand local **fares**.
- Riders want to choose by **budget** ("what's the cheapest way?") not just by
  speed.

Sikka fills that gap: a verified, fare-aware, bilingual (Arabic/English) planner
that includes the informal modes and lets the rider optimize for **money**, not
just minutes.

---

## 3. Who uses it? (Three audiences)

1. **Riders** — the public. Plan a trip, follow it live on the map with GPS
   tracking, save trips, leave reviews.
2. **Admins** — our internal operations team. They maintain the transit data:
   draw and edit routes on a map, manage transport types and fares, review
   crowd-sourced reports, and view analytics.
3. **The engine** — an automated routing "brain" on the server that turns the
   admin-maintained data into actual journeys for riders.

---

## 4. How a trip is planned (the rider's journey, step by step)

1. **Pick start & destination.** The rider sets two points (current GPS location
   or searched places).
2. **Pick a budget style.** Three profiles:
   - **Economic** — cheapest. Uses only informal/cheap modes (bus, serfis,
     microbus) plus a tuktuk for the very first/last stretch. Never a taxi,
     never rail.
   - **Comfortable** — balanced. Buses + rail (metro/train/monorail), with a
     tuktuk or short taxi hop only for the first/last connection.
   - **Premium** — fastest/most direct. Taxi-first: door-to-door taxi or taxi
     connectors onto fast rail.
3. **The engine computes the journey.** It searches our verified network for the
   best route under that budget (details in §7).
4. **The rider sees the result:** an ordered list of legs (walk → bus 13 → walk,
   etc.), each with its **fare, duration, crowding level**, the total cost shown
   as a **price range** (an estimate, not an exact fare), total time, and the
   whole route **drawn on the map** following real streets.
5. **Live tracking.** Once travelling, the app follows the rider's GPS along the
   route, shows progress, estimates remaining time, and alerts them when a leg
   is about to end (time to get off).

### Walking & connector rules (recently tightened)
- **Maximum single walk is ~0.8 km.** Riders complained earlier versions made
  them walk too far and the walking line cut diagonally through city blocks.
- Any access gap **longer than 0.8 km is now ridden, not walked** — filled by an
  on-street **tuktuk** (cheap profiles, up to 3 km) and/or a **taxi** (any
  profile, up to 5 km).
- **All** walk, taxi, and tuktuk leg lines are now **snapped to real streets**
  (via Mapbox) so the map shows a believable on-street path instead of a
  straight diagonal.
- **Prices were loosened and raised:** every fare carries a markup so estimates
  are realistic, and the displayed budget range is intentionally **wide**
  (roughly −20% to +60% of the computed cost) because real fares vary by driver,
  traffic, and demand.

---

## 5. The transport modes Sikka knows

| Mode | Arabic | Fare model | Coverage |
|---|---|---|---|
| Metro | مترو | fixed | 77 routes (Lines 1–3) |
| Train | قطار | fixed | 28 intercity routes |
| Monorail | مونوريل | fixed | 16 routes |
| NTA Bus | أتوبيس النقل الجماعي | ~19 EGP | 110 Cairo routes |
| CTA Bus | أتوبيس الهيئة | ~13 EGP | 31 Alexandria (APTA) routes |
| Serfis (shared van) | سرفيس | ~5 EGP + per-km | 20 Cairo routes |
| Microbus | ميكروباص | variable | variable |
| Tuktuk | توك توك | short hops | first/last mile |
| White Taxi / Uber / Careem | تاكسي / أوبر / كريم | dynamic | always available as connector/fallback |

**"Board anywhere" modes:** buses, serfis, and microbuses don't have neat fixed
stops in reality — you flag them down anywhere along the route. Sikka models this
by sampling synthetic boarding points roughly every 1 km along each route, so a
rider boards at the **nearest** point and rides only the slice they need, instead
of being sent to a far-away official stop.

---

## 6. The big picture architecture (how the pieces fit)

Sikka is a **monorepo** (one code repository holding several related apps),
managed with **pnpm workspaces**. It has four runnable parts:

```
   ┌─────────────────────┐         ┌──────────────────────┐
   │  Rider web app      │  HTTP   │   API Server         │
   │  (artifacts/sikka)  │ ───────▶│ (artifacts/api-server)│
   │  React + Vite       │  /api/* │   Express             │
   │  Mapbox map         │◀─────── │   Routing engine      │
   └─────────────────────┘         └──────────┬───────────┘
                                               │ Drizzle ORM
   ┌─────────────────────┐                     ▼
   │  Intercity web app  │           ┌──────────────────────┐
   │ (artifacts/intercity)│          │  PostgreSQL database  │
   └─────────────────────┘          │  (14 tables)          │
                                     └──────────────────────┘
   External services: Mapbox (maps, geocoding, road snapping),
   Clerk (login), OpenAI (optional trip explanations),
   SuperJet / GoBus / BlueBus (live intercity bus data).
```

1. **Rider web app** (`artifacts/sikka`) — what the public uses. Built with
   **React + Vite**, styled with **Tailwind CSS** and **Radix UI** components,
   map powered by **Mapbox**.
2. **API Server** (`artifacts/api-server`) — the backend brain. Built with
   **Express** (Node.js). Holds all the data routes *and* the routing engine.
3. **Database** (`lib/db`) — **PostgreSQL** with **Drizzle ORM** (a type-safe
   data layer). 14 tables.
4. **Intercity app** (`artifacts/intercity`) — a separate front-end for
   city-to-city travel that aggregates live bus operator data.

---

## 7. The routing engine (the heart of the product)

This is the most technically valuable part of Sikka and worth understanding at a
high level, because it's our differentiator.

**It is deterministic, not AI.** Given the same inputs it always produces the
same answer, and it only ever uses **verified data from our database**. This is a
deliberate, non-negotiable design rule: an AI that hallucinates a non-existent
metro station is worse than no answer at all, because riders act on these
directions in the real world. (AI is used **only** for optional natural-language
explanations of a route, and even that has a non-AI fallback.)

How it works, in plain terms:
1. **Build a network graph.** Every stop becomes a node; riding a line or walking
   between nearby stops becomes a connection ("edge") with a time and money cost.
   Board-anywhere modes are densified into ~1 km boarding points (see §5). The
   graph is large (~50,000 nodes) but built once and reused.
2. **Add the rider's start and end.** Temporary connections are added from the
   rider's exact origin/destination to nearby boarding points — on foot if
   within 0.8 km, otherwise by tuktuk/taxi (§4).
3. **Search for the best route** using a shortest-path search (Dijkstra-style)
   that is **budget-aware** — it weights modes according to the chosen profile
   (economic vs comfortable vs premium).
4. **Respect hard limits on walking.** Walking is treated as a limited resource:
   the search tracks both *total* walking and the *current continuous* walk so it
   can't sneak in an over-long walk by chaining short ones together. Caps:
   ~0.8 km in one stretch, ~1.6 km total.
5. **Reject nonsense routes.** A plan whose total distance wanders too far beyond
   the straight-line distance is thrown out. A final validation gate means Sikka
   returns **only** a fully valid plan; if it somehow can't, it falls back to a
   real door-to-door taxi option (never a made-up route).
6. **Draw it on streets.** Connector legs (walk/taxi/tuktuk) are snapped to the
   real road network so the map looks right.

---

## 8. Intercity travel (Cairo ↔ other cities)

Separate from the city engine, the intercity feature aggregates **live bus
options** from external operators — **SuperJet**, **GoBus**, and **BlueBus** —
through dedicated adapters on the API server. These are public endpoints (no
login needed). If an operator returns no live data, the feature shows a
synthetic estimate so the user still gets guidance.

---

## 9. Admin tooling

Admins maintain the data that the engine depends on, through an in-app dashboard
(`/admin`):
- **Map editor** — draw a transit line by clicking stops; the app **geocodes**
  the stop names and **snaps the route to real roads** via Mapbox.
- **Transport types & fares** — manage modes, prices, colours, icons.
- **Transit lines, locations, terminals (*mawaqef*)** — full create/edit/delete.
- **Reviews, reports, heatmaps** (e.g. where tuktuks are common), **analytics**.
- **One-click data seeding** — endpoints that bulk-load the Cairo network
  (~110 NTA bus routes, metro, monorail, train, serfis) and the Alexandria
  network (31 APTA routes), optionally geocoding and road-snapping every route.

---

## 10. Accounts, login & security

- **Riders** sign in with **Clerk** (email + Google) — a managed authentication
  service, so we don't store passwords ourselves.
- **Admins** are ordinary Clerk users who have been granted an admin role via a
  protected setup step using credentials kept in secure server secrets.
- The API verifies every request's identity before returning user data.
- Secrets (API keys, admin credentials, database connection) are stored in
  your deployment platform's secret manager, never in the code.

---

## 11. Technology stack (the toolbox)

| Layer | Technology | Why |
|---|---|---|
| Repo structure | pnpm monorepo, TypeScript | One repo, shared code, type safety |
| Frontend | React + Vite, Tailwind CSS, Radix UI | Fast, modern, accessible UI |
| Maps | Mapbox GL (maps, geocoding, directions/road-snapping) | Best coverage + styling for the region |
| Backend | Node.js + Express | Lightweight, well-understood API server |
| Database | PostgreSQL + Drizzle ORM | Reliable relational store, type-safe queries |
| Auth | Clerk | Managed login (email + Google), no password handling |
| AI (optional) | OpenAI | Natural-language route explanations only, with fallback |
| Intercity data | SuperJet / GoBus / BlueBus adapters | Live operator schedules |
| Hosting | Render backend + Capacitor frontend | Separate API hosting and mobile app packaging |
| Internationalization | Custom i18n helper | Full Arabic/English, right-to-left support |

---

## 12. Data model (what we store) — 14 tables

- **People:** `profiles`, `user_roles` (plus legacy OTP/phone tables kept but
  unused).
- **Network:** `transport_types`, `transit_lines`, `locations`, `mawaqef`
  (terminals).
- **Trips & social:** `trips`, `trip_segments`, `reviews`,
  `transport_heatmaps`, `trip_notifications`, `trip_shares`.

A key rule prevents duplicate routes, and each transit line is tagged with its
governorate (e.g. Cairo, Alexandria) to drive the admin map's filters.

---

## 13. Status & what's next

**Working today:** city trip planning across all modes with budget profiles,
live map + GPS tracking, the full admin toolset, Cairo + Alexandria seeded data,
intercity bus aggregation, Arabic/English throughout, and the recently improved
walking/pricing/road-snapping behaviour.

**Natural next steps (candidates, not commitments):**
- Broaden verified route coverage to more governorates (the data foundation is
  the main lever on quality).
- Automated tests around the new walk-distance boundaries and fare calculations.
- Richer crowd-sourced data (real-time crowding, fare confirmations from riders).

---

## 14. The one thing to remember

Sikka's value is **trustworthy, fare-aware directions over Egypt's real
(including informal) transit network** — and its core guarantee is that it
**only ever gives routes that actually exist.** Everything else (the map, the
budgets, the live tracking, the admin tools) exists to serve that promise.
