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

@CapacitorPlugin(name = "SikkaTripNotification")
public class SikkaTripNotificationPlugin extends Plugin {
    private static final String CHANNEL_ID = "sikka_active_trip";
    private static final int NOTIFICATION_ID = 3107;
    private static final int REQUEST_NOTIFICATIONS = 3108;

    @PluginMethod
    public void show(PluginCall call) {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            getActivity().requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQUEST_NOTIFICATIONS);
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

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Bitmap largeIcon = buildTransportIcon(icon, color);
        String title = from + " -> " + to + " right now";
        String text = icon.isEmpty() ? transportName : icon + "  " + transportName;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.sikka_app_icon)
            .setLargeIcon(largeIcon)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setColor(color)
            .setColorized(true)
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

    private Bitmap buildTransportIcon(String icon, int color) {
        int size = 192;
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);

        Paint circlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        circlePaint.setColor(color);
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, circlePaint);

        Paint ringPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        ringPaint.setStyle(Paint.Style.STROKE);
        ringPaint.setStrokeWidth(8f);
        ringPaint.setColor(Color.argb(90, 255, 255, 255));
        canvas.drawCircle(size / 2f, size / 2f, size / 2f - 7f, ringPaint);

        Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        textPaint.setColor(Color.WHITE);
        textPaint.setTextAlign(Paint.Align.CENTER);
        textPaint.setTextSize(86f);
        textPaint.setTypeface(Typeface.DEFAULT_BOLD);
        Paint.FontMetrics metrics = textPaint.getFontMetrics();
        float y = size / 2f - (metrics.ascent + metrics.descent) / 2f;

        String glyph = icon == null || icon.trim().isEmpty() ? "●" : icon.trim();
        canvas.drawText(glyph, size / 2f, y, textPaint);
        return bitmap;
    }
}
