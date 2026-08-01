# Sikka Version 26 Patch

This patch updates the app to Android `versionCode 26` / `versionName 1.0.25`.

## What Changed

- Trip discovery GPS reports are tagged as trip-origin reports.
- If trip discovery matches an existing route, it now saves a separate discovery copy for admin review instead of overwriting the original route.
- Profile route contribution submissions still go through the discovery pipeline and are OSRM-refined by the backend before they appear on the discovery/admin side.
- Started trips are posted to `/api/trips` once per active guide, including destination, total cost, and total time, so the analytics trip number is real.
- `/api/trips` posts are queued offline like reports/reviews/discovery reports.
- Nationality analytics now merges Egyptian variants into `Egyptian` and keeps real foreign country names visible.
- Future foreign sign-ins store the selected country in English for cleaner analytics.
- The home map now loads free OSM POIs from Overpass automatically at close zoom, with restaurant/cafe/shop/etc. icons and no extra home-screen button.
- Android release version bumped to `26`.

## Apply In Codespaces

From the repository root:

```bash
unzip -o sikka-version-26-discovery-poi-analytics.zip
pnpm --filter @workspace/sikka run build
pnpm --filter @workspace/api-server run build
git add artifacts lib SIKKA_DISCOVERY_POI_ANALYTICS_VERSION_26_README.md
git commit -m "Update discovery copies, analytics trips, and map POIs"
git push
```

No database migration is required for this patch. It uses existing tables and JSON fields.

## Notes

The POI overlay uses OpenStreetMap Overpass API. It only requests named POIs in the current visible map box at close zoom and caches results during the session to stay light.
