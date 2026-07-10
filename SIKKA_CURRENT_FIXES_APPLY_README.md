# Sikka Current Fixes

Apply from the repository root:

```bash
unzip -o sikka-current-fixes.zip
```

Then run your normal Codespace checks:

```bash
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/sikka run typecheck
pnpm --filter @workspace/sikka run build
```

Notes:

- The always-on Android discovery foreground service is no longer auto-started, and old enabled state is stopped on app launch. Android requires a persistent notification for closed-app background location collection.
- The active trip notification now uses Android's standard colorized notification API instead of a custom inner blue rectangle. Some Android/OEM versions still limit how much of the system notification surface can be tinted.
- The home map POIs use OpenStreetMap data through Overpass API, so production usage should keep OpenStreetMap attribution visible and respect public Overpass API limits.
