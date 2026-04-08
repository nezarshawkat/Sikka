# Sikka — Egypt Multi-Modal Transportation Super App

Production-grade monorepo starter for an Egypt-wide multi-modal trip planner targeting tourists and local commuters.

## What is implemented now (working baseline)

- Backend API (Express) with:
  - `GET /api/v1/route`
  - `GET /api/v1/traffic`
  - `GET /api/v1/taxi-price`
  - `POST /api/v1/report-route`
  - `POST /api/v1/auth/google-signup`
  - `POST /api/v1/auth/phone-signup/start`
  - `POST /api/v1/auth/phone-signup/verify`
- Redis caching for route responses (10 min TTL).
- Routing engine with weighted multi-profile routing (`cheapest`, `fastest`, `balanced`, `comfort`, `tourist`) and transfer penalty.
- PostgreSQL + PostGIS schema and seeds.
- Flutter app scaffold with modern styling direction (glass card, rounded glowing controls, dark/light mode) and functional route search flow.
- React admin dashboard starter.
- Docker Compose stack for database + redis + backend + dashboard.

## Monorepo

```
mobile_app/
backend/
routing_engine/
database/
admin_dashboard/
docker/
scripts/
docs/
```

## Quick Start

```bash
cp backend/.env.example backend/.env
cp admin_dashboard/.env.example admin_dashboard/.env
cp mobile_app/.env.example mobile_app/.env

docker compose -f docker/docker-compose.yml up --build
```

Apply DB migrations and seeds:

```bash
psql "$DATABASE_URL" -f database/migrations/001_init.sql
psql "$DATABASE_URL" -f database/seeds/001_seed_transport_types.sql
```

## Full ENV/API keys you still need to provide

### Core backend
- `NODE_ENV`
- `PORT`
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `ADMIN_JWT_SECRET`

### Maps and location
- `MAPBOX_ACCESS_TOKEN`
- `OSM_TILE_URL`
- `GOOGLE_MAPS_API_KEY`
- `GOOGLE_PLACES_API_KEY`

### Authentication
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_SIGNIN_WEB_CLIENT_ID`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_APP_ID`

### Transport provider integrations
- `UBER_API_KEY`
- `CAREEM_API_KEY`
- `EGYPTIAN_RAIL_API_KEY`
- `FLIGHT_DATA_API_KEY`
- `CURRENCY_API_KEY`

### Observability/analytics
- `SENTRY_DSN`
- `ANALYTICS_WRITE_KEY`

## What remains for final production launch

1. Replace mocked provider adapters (`traffic`, `taxi`, auth verification stubs) with real integrations.
2. Add full GTFS import pipeline + scheduled refresh jobs.
3. Add full auth lifecycle (refresh tokens, logout, RBAC, admin permissions).
4. Add CI/CD pipelines and test suites (unit + integration + e2e).
5. Add offline map download and tile packaging implementation in Flutter.
6. Add real-time live vehicles feed ingestion and websocket push.
7. Add full admin CRUD pages and auditing.
8. Add secrets management (Vault/SSM), rate limits, WAF, backups, and disaster recovery runbooks.

## Design direction in mobile app

- Light and dark modes enabled.
- Rounded controls.
- Glassmorphism component (`GlassCard`).
- Attractive onboarding text and logo placeholder in home.
- Signup placeholders for Google and phone.

## License

Proprietary starter for Sikka.
