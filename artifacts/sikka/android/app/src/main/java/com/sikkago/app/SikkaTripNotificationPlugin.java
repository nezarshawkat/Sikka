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
import android.graphics.Rect;
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

@CapacitorPlugin(name = "SikkaTripNotification")
public class SikkaTripNotificationPlugin extends Plugin {
    private static final String CHANNEL_ID = "sikka_active_trip";
    private static final int NOTIFICATION_ID = 3107;
    private static final int REQUEST_NOTIFICATIONS = 3108;
    private static final int SIKKA_BLUE = Color.rgb(37, 141, 255);

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

        String from = call.getString("from", "Current location");
        String to = call.getString("to", "Destination");
        String transportName = call.getString("transportName", "Sikka");
        String icon = call.getString("icon", "");
        String colorValue = call.getString("color", "#258DFF");
        int color = parseColor(colorValue);
        String routeLabel = shortenText(from, 22) + " → " + shortenText(to, 22);
        String title = transportName;
        String text = routeLabel;

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Bitmap largeIcon = buildTripNotificationBitmap(icon, color, transportName, routeLabel);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.sikka_app_icon)
            .setLargeIcon(largeIcon)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
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

    private Bitmap buildTripNotificationBitmap(String icon, int color, String transportName, String routeLabel) {
        int width = 512;
        int height = 256;
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);

        Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        bgPaint.setColor(Color.WHITE);
        canvas.drawRoundRect(0, 0, width, height, 36f, 36f, bgPaint);

        Paint accentPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        accentPaint.setColor(SIKKA_BLUE);
        canvas.drawRoundRect(0, 0, width, 10f, 5f, 5f, accentPaint);

        Paint circlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        circlePaint.setColor(color);
        canvas.drawCircle(72f, 96f, 34f, circlePaint);

        Paint ringPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        ringPaint.setStyle(Paint.Style.STROKE);
        ringPaint.setStrokeWidth(6f);
        ringPaint.setColor(Color.argb(70, 255, 255, 255));
        canvas.drawCircle(72f, 96f, 28f, ringPaint);

        Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        textPaint.setColor(Color.WHITE);
        textPaint.setTextAlign(Paint.Align.CENTER);
        textPaint.setTextSize(28f);
        textPaint.setTypeface(Typeface.DEFAULT_BOLD);
        Paint.FontMetrics metrics = textPaint.getFontMetrics();
        float y = 96f - (metrics.ascent + metrics.descent) / 2f;
        String glyph = icon == null || icon.trim().isEmpty() ? "●" : icon.trim();
        canvas.drawText(glyph.length() > 2 ? glyph.substring(0, 2) : glyph, 72f, y, textPaint);

        Paint titlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        titlePaint.setColor(Color.rgb(20, 24, 31));
        titlePaint.setTextSize(30f);
        titlePaint.setTypeface(Typeface.DEFAULT_BOLD);
        titlePaint.setTextAlign(Paint.Align.LEFT);
        canvas.drawText(shortenText(transportName, 18), 124f, 80f, titlePaint);

        Paint bodyPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        bodyPaint.setColor(Color.rgb(91, 100, 114));
        bodyPaint.setTextSize(24f);
        bodyPaint.setTextAlign(Paint.Align.LEFT);
        canvas.drawText(shortenText(routeLabel, 34), 124f, 122f, bodyPaint);

        Paint dotPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        dotPaint.setColor(color);
        canvas.drawCircle(width - 46f, 96f, 16f, dotPaint);

        return bitmap;
    }

    private String shortenText(String value, int max) {
        if (value == null) return "";
        String text = value.trim();
        return text.length() <= max ? text : text.substring(0, Math.max(1, max - 1)) + "…";
    }
}
