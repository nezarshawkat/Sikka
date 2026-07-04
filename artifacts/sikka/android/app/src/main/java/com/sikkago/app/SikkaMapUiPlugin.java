package com.sikkago.app;

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

    private void collectMapViews(View view, List<MapView> output) {
        if (view instanceof MapView) output.add((MapView) view);
        if (!(view instanceof ViewGroup)) return;
        ViewGroup group = (ViewGroup) view;
        for (int index = 0; index < group.getChildCount(); index++) {
            collectMapViews(group.getChildAt(index), output);
        }
    }
}
