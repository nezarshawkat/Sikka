package com.sikkago.app;

import android.content.Context;
import android.view.View;
import android.view.ViewGroup;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.maps.MapView;

import java.util.ArrayList;
import java.util.List;

/** Applies the deliberately minimal Sikka control surface to native maps. */
@CapacitorPlugin(name = "SikkaMapUi")
public class SikkaMapUiPlugin extends Plugin {
    private static final String PREFS = "sikka_map_ui_preferences";
    private static final String PREF_TRIP_PIP_ENABLED = "trip_pip_enabled";

    public static boolean isTripPipEnabled(Context context) {
        return context != null
            && context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(PREF_TRIP_PIP_ENABLED, false);
    }

    public static void setTripPipEnabled(Context context, boolean enabled) {
        if (context == null) return;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(PREF_TRIP_PIP_ENABLED, enabled)
            .apply();
    }

    @PluginMethod
    public void configure(PluginCall call) {
        if (getActivity() == null) {
            call.reject("Activity is unavailable");
            return;
        }
        getActivity().runOnUiThread(() -> {
            List<MapView> maps = new ArrayList<>();
            collectMapViews(getActivity().findViewById(android.R.id.content), maps);
            for (MapView mapView : maps) {
                mapView.getMapAsync(map -> {
                    map.getUiSettings().setZoomControlsEnabled(false);
                    map.getUiSettings().setCompassEnabled(false);
                    map.getUiSettings().setMapToolbarEnabled(false);
                    map.getUiSettings().setIndoorLevelPickerEnabled(false);
                    map.getUiSettings().setMyLocationButtonEnabled(false);
                    map.getUiSettings().setTiltGesturesEnabled(false);
                    map.getUiSettings().setRotateGesturesEnabled(false);
                });
            }
            JSObject result = new JSObject();
            result.put("configured", maps.size());
            call.resolve(result);
        });
    }

    @PluginMethod
    public void setTripPipEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        setTripPipEnabled(getContext(), enabled);
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }

    private void collectMapViews(View view, List<MapView> output) {
        if (view instanceof MapView) output.add((MapView) view);
        if (!(view instanceof ViewGroup)) return;
        ViewGroup group = (ViewGroup) view;
        for (int index = 0; index < group.getChildCount(); index++) {
            collectMapViews(group.getChildAt(index), output);
        }
    }
}
