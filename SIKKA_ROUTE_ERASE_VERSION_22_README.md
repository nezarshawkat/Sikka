# Sikka Route Erase Fix - Version 22

This patch makes the active trip route line shrink behind the user as they move, using monotonic route progress in meters instead of trimming from a raw GPS nearest-point guess.

Changed files:
- `artifacts/sikka/src/hooks/useTripTracking.ts`
- `artifacts/sikka/src/pages/Index.tsx`
- `artifacts/sikka/android/app/build.gradle`

What changed:
- GPS progress now projects the user position onto the current route leg and keeps traveled route meters monotonic, so GPS jitter cannot redraw erased route behind the user.
- The map route GeoJSON now removes already-traveled meters from the displayed route, leg by leg.
- Android release version was bumped to `versionCode 22` and `versionName "1.0.21"`.

Apply in Codespace:

```bash
unzip -o sikka-route-erase-version-22-linux.zip
git add artifacts/sikka/src/hooks/useTripTracking.ts artifacts/sikka/src/pages/Index.tsx artifacts/sikka/android/app/build.gradle SIKKA_ROUTE_ERASE_VERSION_22_README.md
git commit -m "Fix active route erasing and bump version 22"
git push
```

Then run your GitHub Action to build the signed release AAB.
