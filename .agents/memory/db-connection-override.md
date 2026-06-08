---
name: DB connection override (external Postgres / Neon)
description: How to point this app at an external Postgres when Replit reserves DATABASE_URL
---

# Pointing the app at an external Postgres (Neon, etc.)

`DATABASE_URL` is **runtime-managed/reserved** by Replit's built-in PostgreSQL. It
cannot be set via `setEnvVars` (it's a secret) and **cannot be requested via
`requestEnvVar`** either — that call errors with "directly populated by Replit ...
should not be requested". So you cannot simply overwrite `DATABASE_URL` to use an
external DB while the built-in DB is provisioned.

**Rule / pattern in this repo:** the DB layer prefers `DATABASE_URL_OVERRIDE` when
present, else falls back to `DATABASE_URL`. Both `lib/db/src/index.ts` (runtime pool)
and `lib/db/drizzle.config.ts` (drizzle-kit push) read
`process.env.DATABASE_URL_OVERRIDE || process.env.DATABASE_URL`.

**Why:** lets the user run on an external Postgres without fighting Replit's reserved
var, and it's reversible — delete the `DATABASE_URL_OVERRIDE` secret and the app
reverts to the built-in DB on next restart.

**How to apply:**
- Set `DATABASE_URL_OVERRIDE` as a normal secret (non-reserved name, so `requestEnvVar`
  works), then restart workflows.
- Schema push: `pnpm --filter @workspace/db run push` targets whichever URL wins
  (override if set).
- Faithful data migration between two live Postgres instances: `pg_dump <src>
  --no-owner --no-privileges --clean --if-exists | psql <dest>`. Don't rely on
  `seedDirect.ts` for parity — it's stale (omits NOT-NULL `from_area`/`to_area`/`stops`).
- To confirm the running app actually uses the override DB when both DBs hold identical
  data: write a sentinel value into the target DB only, fetch via a live API endpoint,
  then revert.
