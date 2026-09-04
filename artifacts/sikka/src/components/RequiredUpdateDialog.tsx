import { useEffect, useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { getMobileAppConfig } from "@/lib/appConfig";
import { getInstalledAndroidBuildNumber } from "@/lib/nativeAppInfo";

export default function RequiredUpdateDialog() {
  const [playStoreUrl, setPlayStoreUrl] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([getMobileAppConfig(), getInstalledAndroidBuildNumber()])
      .then(([config, currentBuild]) => {
        if (!active || !config.playStoreUrl || !config.minimumAndroidVersion) return;
        if (currentBuild !== null && currentBuild < config.minimumAndroidVersion) setPlayStoreUrl(config.playStoreUrl);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <AlertDialog open={Boolean(playStoreUrl)} onOpenChange={() => undefined}>
      <AlertDialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Update required</AlertDialogTitle>
          <AlertDialogDescription>
            A newer version of Sikka is required to continue. Update now from Google Play.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => window.location.assign(playStoreUrl)}>Update the app</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
