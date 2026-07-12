# Sikka Android AAB Workflow

Apply from the repository root:

```bash
unzip -o sikka-release-aab-workflow.zip
```

The existing workflow file stays at:

```text
.github/workflows/android-apk.yml
```

It now:

- shows as `Build Android Release AAB` in GitHub Actions
- runs `./gradlew bundleRelease`
- uploads the artifact as `sikka-release-aab`
- reads the bundle from `artifacts/sikka/android/app/build/outputs/bundle/release/*.aab`

Note: this builds the Android `release` variant. If Google Play rejects it for signing, add release signing secrets/config next.
