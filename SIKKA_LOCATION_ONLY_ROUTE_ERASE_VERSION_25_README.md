# Sikka Location-Only Route Erase - Version 25

This patch keeps the active trip route line erased only by the rider's real GPS location on the trip route.

Changed behavior:
- Pressing Next/Back in the trip popup no longer removes route geometry from the map.
- Route erasing is driven only by `routeProgressMeters`, which comes from the user's nearest GPS projection on the full route.
- If the user has not physically moved along the route, the route remains visible even when the selected popup leg changes.
- The popup loading/progress line remains GPS-based.
- Includes the version 24 discovery validation, snap-to-street, and strict direction matching changes.
- Android release version was bumped to `versionCode 25` and `versionName "1.0.24"`.

Apply in Codespace:

```bash
unzip -o sikka-location-only-route-erase-version-25-linux.zip
git add artifacts/sikka/src/hooks/useTripTracking.ts artifacts/sikka/src/pages/Index.tsx artifacts/sikka/android/app/build.gradle artifacts/api-server/src/routes/transportReports.ts lib/db/src/schema/sikka.ts artifacts/sikka/src/pages/admin/AdminDiscovery.tsx SIKKA_LOCATION_ONLY_ROUTE_ERASE_VERSION_25_README.md
git commit -m "Make route erasing depend only on rider location"
git push
```

Then redeploy the backend if needed and run your GitHub Action for the signed release AAB.
