package com.sikkago.app;

import android.content.pm.PackageInfo;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Exposes the installed Android versionCode to the required-update gate. */
@CapacitorPlugin(name = "SikkaAppInfo")
public class SikkaAppInfoPlugin extends Plugin {
    @PluginMethod
    public void getBuildNumber(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
            call.resolve(new com.getcapacitor.JSObject().put("buildNumber", versionCode));
        } catch (Exception error) {
            call.reject("Could not determine installed app version", error);
        }
    }
}
