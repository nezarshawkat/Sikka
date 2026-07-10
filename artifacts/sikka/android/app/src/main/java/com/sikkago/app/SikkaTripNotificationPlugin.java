package com.sikkago.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Persistent active-trip notification.
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

        String to = call.getString("to", "");
        String transportName = call.getString("transportName", "Sikka");
        String modeLabel = call.getString("modeLabel", "");
        String language = call.getString("language", "en");
        int badgeColor = parseColor(call.getString("color", "#258DFF"));
        boolean isArabic = isArabicLang(language);
        String subtitle = (isArabic ? "\u0628\u0627\u062A\u062C\u0627\u0647 " : "toward ") + shortenText(to, 30);

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.sikka_app_icon)
            .setLargeIcon(buildBadgeIcon(context, badgeColor, badgeTextFor(modeLabel, transportName)))
            .setContentTitle(shortenText(transportName, 40))
            .setContentText(subtitle)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(subtitle))
            .setColor(SIKKA_BLUE)
            .setColorized(true)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
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

    private String badgeTextFor(String modeLabel, String transportName) {
        String source = modeLabel != null && !modeLabel.trim().isEmpty() ? modeLabel.trim() : transportName == null ? "" : transportName.trim();
        if (source.isEmpty()) return "";
        return source.length() <= 2 ? source : source.substring(0, 1).toUpperCase(java.util.Locale.ROOT);
    }

    private Bitmap buildBadgeIcon(Context context, int badgeColor, String text) {
        int size = dp(context, 48);
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);

        Paint circlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        circlePaint.setColor(badgeColor);
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, circlePaint);

        Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        textPaint.setColor(Color.WHITE);
        textPaint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        textPaint.setTextAlign(Paint.Align.CENTER);
        textPaint.setTextSize(dp(context, text.length() > 1 ? 18 : 22));
        Paint.FontMetrics metrics = textPaint.getFontMetrics();
        float y = size / 2f - (metrics.ascent + metrics.descent) / 2f;
        canvas.drawText(text, size / 2f, y, textPaint);
        return bitmap;
    }

    private int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    private String shortenText(String value, int max) {
        if (value == null) return "";
        String text = value.trim();
        return text.length() <= max ? text : text.substring(0, Math.max(1, max - 3)) + "...";
    }
}
