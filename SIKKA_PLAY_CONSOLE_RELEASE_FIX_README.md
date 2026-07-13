# Google Play Release Fix

Apply from the repository root:

```bash
unzip -o sikka-play-console-release-fix-linux.zip
```

This bumps the Android release version to:

```text
applicationId = sikka.app
versionCode = 20
versionName = 1.0.19
```

If Play Console already has version code `20` or higher, increase `versionCode` in:

```text
artifacts/sikka/android/app/build.gradle
```

Use any number higher than the highest version code shown in Play Console.

## Fix The Bundle Errors

1. Commit and push this change.
2. Run GitHub Actions: `Build Android Release AAB`.
3. Download the new `sikka-release-aab` artifact.
4. In Play Console, create a new release or edit the draft release.
5. Remove the old uploaded bundle from that draft.
6. Upload the new `.aab` with the higher version code.

## Foreground Service Declaration

Google Play asks because the Android manifest includes:

```text
android.permission.FOREGROUND_SERVICE
android.permission.FOREGROUND_SERVICE_LOCATION
```

In Play Console go to:

```text
Policy -> App content -> Foreground service permissions
```

Choose that the app uses Foreground Service permissions.

Declare:

```text
Type: Location
Use case: User-initiated navigation / trip guidance and route discovery
Explanation: Sikka uses a location foreground service only for active trip guidance or route discovery so the rider's route progress and contributed transport trace can continue reliably. The user sees a persistent notification and can stop the trip or recording.
```

If Play asks for a demo video, show:

1. starting a trip or route recording,
2. the persistent notification,
3. stopping/ending the trip or recording.
