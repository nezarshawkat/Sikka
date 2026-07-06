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
 * bitmap. That gives it real, non-cropped text in the app's actual Cairo font
 * files (bundled under res/font/), instead of baking everything into an image
 * that Android's notification template may crop or rescale unpredictably.
 *
 * Left circle: the Sikka mark, always the same — it's branding, not per-trip data.
 *
 * Right circle: the one dynamic part — tinted to the current leg's actual line
 * color and labeled with the actual mode being ridden (e.g. "Bus", "Metro",
 * "Microbus"), both provided by the caller rather than guessed here, since the
 * JS side already knows the correct localized label and the real line color.
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

        String to = call.getString("to", "Destination");
        String transportName = call.getString("transportName", "Sikka");
        String modeLabel = call.getString("modeLabel", "");
        String language = call.getString("language", "en");
        int color = parseColor(call.getString("color", "#258DFF"));
        boolean isArabic = isArabicLang(language);
        String subtitle = (isArabic ? "باتجاه " : "toward ") + shortenText(to, 26);

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
            .setColorized(false)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
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
            NotificationManager.IMPORTANCE_LOW
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

        // Right badge: the one part of this view that actually changes — tinted
        // to the real line color and labeled with the real mode being ridden,
        // instead of staying a fixed placeholder.
        views.setInt(R.id.trip_badge_circle_bg, "setColorFilter", badgeColor);
        views.setTextViewText(R.id.trip_badge_text, badgeTextFor(modeLabel, title));

        views.setTextViewText(R.id.trip_title, shortenText(title, 20));
        views.setTextViewText(R.id.trip_subtitle, subtitle);
        return views;
    }

    /** The real, already-localized mode label when we have one; otherwise a
     *  short fallback derived from the transport name so the badge is never
     *  left blank. */
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
