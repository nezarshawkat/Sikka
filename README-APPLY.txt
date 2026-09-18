Sikka phone-route patch

Apply in GitHub Codespace from the repository root:

  unzip -o sikka-phone-routes-patch.zip

Or apply only the patch file:

  git apply sikka-phone-routes.patch

This is a frontend/mobile app change. It makes trip planning read the saved phone snapshot directly and changes online route sync to merge additions/updates into the phone cache instead of replacing it.