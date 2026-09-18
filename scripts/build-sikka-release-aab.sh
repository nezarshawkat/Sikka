#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/artifacts/sikka"
ANDROID_DIR="$APP_DIR/android"

if [[ -n "${ANDROID_KEYSTORE_BASE64:-}" ]]; then
  KEYSTORE_PATH="$ANDROID_DIR/release-upload-key.jks"
  printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$KEYSTORE_PATH"
  export ANDROID_RELEASE_STORE_FILE="${ANDROID_RELEASE_STORE_FILE:-release-upload-key.jks}"
fi

missing=()
for name in ANDROID_RELEASE_STORE_FILE ANDROID_RELEASE_STORE_PASSWORD ANDROID_RELEASE_KEY_ALIAS ANDROID_RELEASE_KEY_PASSWORD GOOGLE_MAPS_ANDROID_API_KEY; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf 'Missing required release environment variable(s): %s\n' "${missing[*]}" >&2
  printf 'Set them in Codespace secrets or export them before running this script.\n' >&2
  exit 1
fi

cd "$ROOT_DIR"
pnpm install --frozen-lockfile
pnpm --filter @workspace/sikka run cap:sync

cd "$ANDROID_DIR"
./gradlew bundleRelease

printf '\nRelease AAB created at:\n'
printf '  %s\n' "$ANDROID_DIR/app/build/outputs/bundle/release/app-release.aab"
