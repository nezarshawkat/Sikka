package com.sikkago.app;

import android.content.Intent;
import android.location.LocationManager;
import android.net.Uri;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.common.api.ResolvableApiException;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.LocationSettingsRequest;
import com.google.android.gms.location.Priority;
import com.google.android.gms.location.SettingsClient;

@CapacitorPlugin(name = "SikkaLocationSettings")
public class SikkaLocationSettingsPlugin extends Plugin {
    private static final int ENABLE_LOCATION_REQUEST = 4217;

    @PluginMethod
    public void isLocationEnabled(PluginCall call) {
        LocationManager manager = (LocationManager) getContext().getSystemService(android.content.Context.LOCATION_SERVICE);
        boolean enabled = false;
        if (manager != null) {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) enabled = manager.isLocationEnabled();
            else enabled = manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
                || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        }
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }

    /** Shows Google's/Android's official resolvable location-settings dialog. */
    @PluginMethod
    public void promptEnableLocation(PluginCall call) {
        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10_000L)
            .setMinUpdateIntervalMillis(5_000L)
            .build();
        LocationSettingsRequest settingsRequest = new LocationSettingsRequest.Builder()
            .addLocationRequest(request)
            .setAlwaysShow(true)
            .build();
        SettingsClient client = LocationServices.getSettingsClient(getContext());
        client.checkLocationSettings(settingsRequest)
            .addOnSuccessListener(response -> {
                JSObject result = new JSObject();
                result.put("enabled", true);
                result.put("prompted", false);
                call.resolve(result);
            })
            .addOnFailureListener(error -> {
                boolean prompted = false;
                if (error instanceof ResolvableApiException && getActivity() != null) {
                    try {
                        ((ResolvableApiException) error).startResolutionForResult(getActivity(), ENABLE_LOCATION_REQUEST);
                        prompted = true;
                    } catch (Exception ignored) {}
                }
                if (!prompted) {
                    Intent intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(intent);
                }
                JSObject result = new JSObject();
                result.put("enabled", false);
                result.put("prompted", true);
                call.resolve(result);
            });
    }

    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        JSObject result = new JSObject();
        result.put("opened", true);
        call.resolve(result);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);

        JSObject result = new JSObject();
        result.put("opened", true);
        call.resolve(result);
    }
}
