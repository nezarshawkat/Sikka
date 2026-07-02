# Sikka edit package

Generated against snapshot revision `3-1782906418628-13-623-62`.

## Route repair result

- Docker Desktop and WSL 2 repaired and verified with `hello-world`.
- Local Valhalla 3.7.0 built from the Egypt OpenStreetMap extract.
- 622 current lines audited.
- 596 eligible non-GTFS road routes regenerated.
- 6 GTFS routes and 20 fixed-guideway routes were excluded.
- Final independent audit after local OSM-name matching: 437 high-confidence routes, 159 medium review candidates, 0 low-confidence routes.
- Every generated geometry passed local Valhalla road-correlation sampling.
- The final audit downgraded 11 attempted OSM-name upgrades that did not independently pass.

High-confidence candidates are publishable. Medium candidates remain review-only, including endpoint-only fallbacks where the original corridor evidence was corrupted.

## Database application

1. Apply `scripts/route-repair-schema.sql` to the target PostgreSQL database.
2. Build the API server with `node artifacts/api-server/build.mjs`.
3. Set `DATABASE_URL` to the Render PostgreSQL external connection string.
4. Run `node artifacts/api-server/dist/scripts/importOfflineRoadCandidates.mjs`.

The importer is idempotent by snapshot revision. It publishes only independently verified high-confidence routes and saves medium routes as review candidates.

## Runtime routing

Set `VALHALLA_URL=http://localhost:8002` when running the backend locally. The Valhalla container is named `sikka-valhalla` and has `--restart unless-stopped`.
