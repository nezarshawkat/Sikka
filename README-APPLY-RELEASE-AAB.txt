Sikka release AAB patch

Apply in GitHub Codespace from the repository root:

  unzip -o sikka-release-aab-patch.zip

This zip includes:
- The phone/local route cache fix.
- Android version bump to versionCode 50 / versionName 1.0.49.
- scripts/build-sikka-release-aab.sh to build a signed release AAB in Codespace.
- .github/workflows/sikka-release-aab.yml to build the AAB from GitHub Actions manually.

Required secrets/env vars before building:
- ANDROID_KEYSTORE_BASE64
- ANDROID_RELEASE_STORE_PASSWORD
- ANDROID_RELEASE_KEY_ALIAS
- ANDROID_RELEASE_KEY_PASSWORD
- GOOGLE_MAPS_ANDROID_API_KEY

Manual Codespace build:

  bash scripts/build-sikka-release-aab.sh

Output AAB:

  artifacts/sikka/android/app/build/outputs/bundle/release/app-release.aab

GitHub Actions build:
- Push this patch.
- Go to Actions > Build Sikka Release AAB > Run workflow.
- Download the sikka-release-aab artifact.