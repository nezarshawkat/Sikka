package com.sikkago.app;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.URLEncoder;

@CapacitorPlugin(name = "SikkaShare")
public class SikkaSharePlugin extends Plugin {
    @PluginMethod
    public void share(PluginCall call) {
        String title = call.getString("title", "Sikka");
        String text = call.getString("text", "");
        String url = call.getString("url", "");
        String shareText = (text + (url.isEmpty() ? "" : "\n" + url)).trim();

        Intent sendIntent = new Intent(Intent.ACTION_SEND);
        sendIntent.setType("text/plain");
        sendIntent.putExtra(Intent.EXTRA_TITLE, title);
        sendIntent.putExtra(Intent.EXTRA_SUBJECT, title);
        sendIntent.putExtra(Intent.EXTRA_TEXT, shareText.isEmpty() ? url : shareText);

        Intent chooser = Intent.createChooser(sendIntent, title);
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(chooser);

        JSObject result = new JSObject();
        result.put("opened", true);
        call.resolve(result);
    }

    /**
     * Generic destination-sharing flow for "Open in Taxi Apps": hands the
     * destination to Android's own geo intent resolution instead of
     * hardcoding any specific ride-hailing app. Android shows a chooser of
     * every installed app that declared itself able to handle a location
     * (Google Maps, Waze, and ride/taxi apps that register for geo intents
     * the same way they support "get a ride" buttons in other apps). If the
     * chosen app supports pre-filled destinations it will receive the
     * coordinates and/or name; if not, the user still picked a real app via
     * the normal Android chooser.
     */
    @PluginMethod
    public void openDestination(PluginCall call) {
        Double lat = call.getDouble("latitude");
        Double lng = call.getDouble("longitude");
        String name = call.getString("name", "");

        boolean hasCoords = lat != null && lng != null;
        if (!hasCoords && (name == null || name.trim().isEmpty())) {
            call.reject("Missing destination latitude/longitude or name");
            return;
        }

        String query = hasCoords
                ? lat + "," + lng + (name != null && !name.trim().isEmpty() ? "(" + name.trim() + ")" : "")
                : name.trim();

        String encodedQuery;
        try {
            encodedQuery = URLEncoder.encode(query, "UTF-8").replace("+", "%20");
        } catch (Exception e) {
            encodedQuery = Uri.encode(query);
        }

        String geoBase = hasCoords ? (lat + "," + lng) : "0,0";
        Uri geoUri = Uri.parse("geo:" + geoBase + "?q=" + encodedQuery);
        Intent intent = new Intent(Intent.ACTION_VIEW, geoUri);

        JSObject result = new JSObject();
        if (intent.resolveActivity(getContext().getPackageManager()) != null) {
            String chooserTitle = (name != null && !name.trim().isEmpty()) ? name.trim() : "Open destination";
            Intent chooser = Intent.createChooser(intent, chooserTitle);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            result.put("opened", true);
        } else {
            result.put("opened", false);
        }
        call.resolve(result);
    }
}
