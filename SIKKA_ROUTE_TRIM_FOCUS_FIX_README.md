# Sikka Route Trim + Focus Fix

Apply from the repository root:

```bash
unzip -o sikka-route-trim-focus-fix-linux.zip
```

This updates:

```text
artifacts/sikka/src/pages/Index.tsx
```

Changes:

- During an active trip, completed parts of the route line are removed from the map.
- The current leg line starts from the rider's nearest projected position on the route.
- Future legs remain visible.
- The focus button keeps its original bottom position instead of jumping when the trip popup changes height.
