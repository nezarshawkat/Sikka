well look here in the uploaded image this is the design of the notification and i need to to be as this exactly... 

Notification is not correct; you made the notification design inside the notification itself as a block inside it... i need it to be THE NOTIFICATION ITESLF TO BE WITH THIS BACKGROUND COLOR AND CONTAINS THE DETAILS INSIDE THE BLUE RECTANGLE AND THE LOGO BE THE APP NOTIFICATION ICON THE NOTIFICATION ITSEFT BACKGROUND COLOR BE THE SAME AS THE ONE INSIDE THE RECTANGLE AND REMOVE THE RECTANGEL ITSELF



look at the needed code and edit on it and send the full code

package com.sikkago.app;



import android.Manifest;

import android.app.NotificationChannel;

import android.app.NotificationManager;

import android.app.PendingIntent;

import android.content.Context;

import android.content.Intent;

import android.content.pm.PackageManager;
package com.sikkago.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.widget.RemoteViews;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Persistent "active trip" notification, built from res/layout/notification_trip.xml
 * (or notification_trip_ar.xml for Arabic) via RemoteViews rather than a painted
 * bitmap.
 */
@CapacitorPlugin(name = "SikkaTripNotification")
public class SikkaTripNotificationPlugin extends Plugin {
    private static final String CHANNEL_ID = "sikka_active_trip";
    private static final int NOTIFICATION_ID = 3107;
    private static final int REQUEST_NOTIFICATIONS = 3108;
    private static final int SIKKA_BLUE = Color.parseColor("#258DFF");

    @PluginMethod
    public void show(PluginCall call) {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            if (getActivity() != null) {
                getActivity().requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQUEST_NOTIFICATIONS);
            }
            JSObject result = new JSObject();
            result.put("shown", false);
            result.put("permissionRequested", true);
            call.resolve(result);
            return;
        }

        ensureChannel(context);

        // Fetching live data sent from TypeScript
        String to = call.getString("to", "");
        String transportName = call.getString("transportName", "Sikka");
        String modeLabel = call.getString("modeLabel", "");
        String language = call.getString("language", "en");
        int color = parseColor(call.getString("color", "#258DFF"));
        boolean isArabic = isArabicLang(language);
        
        // Dynamically build the text
        String subtitle = (isArabic ? "باتجاه " : "toward ") + shortenText(to, 30);

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        RemoteViews views = buildTripViews(context, isArabic, color, transportName, subtitle, modeLabel);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.sikka_app_icon)
            .setContentTitle(transportName)
            .setContentText(subtitle)
            .setCustomContentView(views)
            .setCustomBigContentView(views)
            .setColor(SIKKA_BLUE)
            .setColorized(true) // FIX: Forces the entire native notification background to be blue
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_MAX) // Required for colorized backgrounds
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setContentIntent(pendingIntent);

        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
        JSObject result = new JSObject();
        result.put("shown", true);
        call.resolve(result);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancel(NOTIFICATION_ID);
        call.resolve();
    }

    private boolean isArabicLang(String language) {
        return language != null && language.toLowerCase(java.util.Locale.ROOT).startsWith("ar");
    }

    private void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Active Sikka trip",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Persistent navigation notification while a Sikka trip is active.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private int parseColor(String colorValue) {
        try {
            return Color.parseColor(colorValue);
        } catch (Exception ignored) {
            return Color.parseColor("#258DFF");
        }
    }

    private RemoteViews buildTripViews(
        Context context,
        boolean isArabic,
        int badgeColor,
        String title,
        String subtitle,
        String modeLabel
    ) {
        int layoutRes = isArabic ? R.layout.notification_trip_ar : R.layout.notification_trip;
        RemoteViews views = new RemoteViews(context.getPackageName(), layoutRes);

        views.setInt(R.id.trip_badge_circle_bg, "setColorFilter", badgeColor);
        views.setTextViewText(R.id.trip_badge_text, badgeTextFor(modeLabel, title));

        views.setTextViewText(R.id.trip_title, shortenText(title, 40));
        views.setTextViewText(R.id.trip_subtitle, subtitle);
        return views;
    }

    private String badgeTextFor(String modeLabel, String transportName) {
        if (modeLabel != null && !modeLabel.trim().isEmpty()) {
            return modeLabel.trim();
        }
        return transportName == null ? "" : transportName.trim();
    }

    private String shortenText(String value, int max) {
        if (value == null) return "";
        String text = value.trim();
        return text.length() <= max ? text : text.substring(0, Math.max(1, max - 1)) + "…";
    }
}
the code u need ask for it if not one of those + gimme full code