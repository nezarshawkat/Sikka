# Sikka Signed Release AAB Workflow

Apply from the repository root:

```bash
unzip -o sikka-signed-sikka-app-aab-workflow-linux.zip
```

This zip wires GitHub Actions to build a signed release Android App Bundle:

- workflow: `.github/workflows/android-apk.yml`
- Gradle signing config: `artifacts/sikka/android/app/build.gradle`
- package name / application id: `sikka.app`
- build command: `./gradlew bundleRelease`
- uploaded artifact: `sikka-release-aab`
- output path: `artifacts/sikka/android/app/build/outputs/bundle/release/*.aab`

You still must add the private signing values to GitHub Secrets. Do not commit the keystore.

## Create The Keystore

Run in Codespace:

```bash
keytool -genkeypair -v \
  -keystore upload-keystore.jks \
  -alias sikka-upload \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Save the keystore password and key password somewhere private.

Convert the keystore to one-line base64:

```bash
base64 -w 0 upload-keystore.jks > upload-keystore.base64
```

## Add GitHub Secrets

Go to:

```text
GitHub repo -> Settings -> Secrets and variables -> Actions -> New repository secret
```

Add:

```text
ANDROID_KEYSTORE_BASE64
```

Value: contents of `upload-keystore.base64`

```text
ANDROID_RELEASE_STORE_PASSWORD
```

Value: keystore password

```text
ANDROID_RELEASE_KEY_ALIAS
```

Value:

```text
sikka-upload
```

```text
ANDROID_RELEASE_KEY_PASSWORD
```

Value: key password

After adding secrets, delete local private files:

```bash
rm upload-keystore.jks upload-keystore.base64
```

Then run the GitHub Action `Build Android Release AAB`.

Important: if this app was already uploaded to Google Play with another upload key, use that existing upload key or reset it in Play Console.
