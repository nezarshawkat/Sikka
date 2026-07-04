# Sikka final route/app package

This package contains the complete source edits and the audited 521-route
device seed. The route file is already embedded in
`artifacts/sikka/src/data/bundledSnapshot.json`.

The backend replacement is intentionally non-destructive: accepted routes are
upserted and excluded legacy/broken routes are deactivated with their audit
history preserved. Nothing is physically deleted.

Required Codespace secrets/environment variables:

- `DATABASE_URL`
- `GOOGLE_MAPS_ANDROID_API_KEY`

Run the command supplied with the ZIP from the repository root. It validates
the seed hash, applies exactly 521 active backend routes, rebuilds the frontend,
and synchronizes the native Android project.
