# Sikka update — "Rate us" after trip completion

10 files. Apply at repo root. Version bumped to versionCode 39 / versionName
1.0.38.

## ⚠️ Required manual step before deploying
`hasRatedApp` is a new column on `profiles` (schema-driven, like the
"rejected" status before it). From `lib/db`, run:
```
pnpm push
```
against your real database before this ships, or profile reads/writes will
fail once the app starts sending `hasRatedApp`.

## What it does
Fires right after a trip finishes (same moment as `tripComplete` — whether
the rider actually filled out the internal trip review or tapped Skip,
both count as "finished"). Checks `profile.hasRatedApp` first — if they've
already rated, nothing shows.

**Tapping a star does everything in one motion** (this is the "as easy as
possible" part):
1. Tries Google Play's own **In-App Review API** first — this is Google's
   own native star-rating overlay that appears *without leaving your app*.
   It's the closest thing to what you described as "put the stars/review
   automatically."
2. If that's not available (falls back gracefully — non-Android, API
   unavailable, etc.), opens the Play Store listing directly via a
   `market://` deep link (straight into the Play Store app, not a browser),
   falling back further to the plain web URL if even that fails.
3. Marks `hasRatedApp: true` on the profile either way and closes.

**"Later" is the only way to see it again** — it just closes without
setting the flag, so it reappears after the next completed trip, exactly
as you asked.

## One thing I can't build, and why
You asked if the stars or review text can be **auto-filled**. I can't do
that, and I'd flag it even if I could: Google Play's Developer Policy
explicitly prohibits apps from seeing, setting, or influencing what rating
a user picks through the in-app review API — it's designed that way
specifically to prevent apps from faking or steering their own ratings.
Doing this any other way (e.g. a custom UI that then submits a canned
5-star review) would risk your app getting flagged or removed for review
manipulation. What I built is the legitimate, Google-sanctioned version of
"as few taps as possible" — one tap, native overlay, done.

I also deliberately did **not** build "only send positive raters to the
Play Store, show a private form to negative ones" (a pattern called review
gating) — that's a separate, explicitly named policy violation. Every star
count triggers the same flow, uniformly.

## New files
- `SikkaRatePlugin.java` — native plugin (Play In-App Review + market://
  fallback)
- `RateUsDialog.tsx` — the prompt itself, matching the existing
  `SegmentReviewDialog`'s star-row visual language and `rounded-[2rem]`
  dialog styling already used throughout the app
- `nativeRating.ts` — JS wrapper with web fallback

## Also added
`com.google.android.play:review:2.0.2` dependency in `build.gradle` —
verified against Google's current official documentation, not guessed.
