package com.sikkago.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;

@CapacitorPlugin(
    name = "SikkaDiscovery",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class SikkaDiscoveryPlugin extends Plugin {
    @PluginMethod
    public void startAlwaysOn(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "locationPermissionResult");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void locationPermissionResult(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Location permission was not granted");
            return;
        }
        startService(call);
    }

    private void startService(PluginCall call) {
        SikkaDiscoveryService.setEnabled(getContext(), true);
        Intent intent = new Intent(getContext(), SikkaDiscoveryService.class);
        ContextCompat.startForegroundService(getContext(), intent);
        JSObject result = new JSObject();
        result.put("enabled", true);
        result.put("notificationPermission", Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(result);
    }

    @PluginMethod
    public void stopAlwaysOn(PluginCall call) {
        SikkaDiscoveryService.setEnabled(getContext(), false);
        Intent intent = new Intent(getContext(), SikkaDiscoveryService.class);
        getContext().stopService(intent);
        JSObject result = new JSObject();
        result.put("enabled", false);
        call.resolve(result);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", SikkaDiscoveryService.isEnabled(getContext()));
        result.put("locationPermission", getPermissionState("location").toString());
        result.put("notificationPermission", getPermissionState("notifications").toString());
        result.put("pendingCount", SikkaDiscoveryService.pendingTrips(getContext()).length());
        call.resolve(result);
    }

    @PluginMethod
    public void getPendingTrips(PluginCall call) {
        JSONArray pending = SikkaDiscoveryService.pendingTrips(getContext());
        JSObject result = new JSObject();
        try { result.put("trips", new JSArray(pending.toString())); }
        catch (JSONException ignored) { result.put("trips", new JSArray()); }
        call.resolve(result);
    }

    @PluginMethod
    public void acknowledgeTrip(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.trim().isEmpty()) {
            call.reject("Trip id is required");
            return;
        }
        JSObject result = new JSObject();
        result.put("removed", SikkaDiscoveryService.acknowledgeTrip(getContext(), id));
        call.resolve(result);
    }
}
