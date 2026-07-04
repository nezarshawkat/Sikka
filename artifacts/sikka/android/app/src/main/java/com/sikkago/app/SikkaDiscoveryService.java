package com.sikkago.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.util.AtomicFile;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Native, durable transit-discovery recorder. The WebView may be suspended or
 * destroyed; accepted GPS fixes and detector state are atomically persisted
 * after every update and recovered when Android restarts this sticky service.
 */
public class SikkaDiscoveryService extends Service implements LocationListener {
    public static final String PREFS = "sikka_discovery_preferences";
    public static final String PREF_ENABLED = "enabled";
    private static final String STATE_FILE = "sikka-discovery-state.json";
    private static final String CHANNEL_ID = "sikka_always_on_discovery";
    private static final int NOTIFICATION_ID = 4218;
    private static final long UPDATE_MS = 5_000L;
    // Keep a short pre-roll so the saved first point is the boarding area,
    // without dragging an earlier walking approach into the vehicle route.
    private static final long RECENT_WINDOW_MS = 45_000L;
    private static final long STOP_WINDOW_MS = 180_000L;
    private static final float START_SPEED_MPS = 2.8f;
    private static final float STOP_SPEED_MPS = 1.2f;
    private static final float MAX_ACCURACY_METERS = 80f;
    private static final float MIN_TRIP_METERS = 500f;
    private static final long MIN_TRIP_MS = 120_000L;
    private static final Object STORE_LOCK = new Object();
    private static volatile SikkaDiscoveryService instance;

    private LocationManager locationManager;
    private JSONArray recent = new JSONArray();
    private JSONArray active = new JSONArray();
    private JSONArray pending = new JSONArray();
    private boolean recording = false;
    private int movingFixes = 0;
    private long stoppedSince = 0L;
    private float activeDistanceMeters = 0f;
    private Location lastLocation;

    public static boolean isEnabled(Context context) {
        return context.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(PREF_ENABLED, false);
    }

    public static void setEnabled(Context context, boolean enabled) {
        context.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(PREF_ENABLED, enabled).apply();
    }

    public static void ensureStarted(Context context) {
        if (!isEnabled(context)) return;
        Intent intent = new Intent(context, SikkaDiscoveryService.class);
        try {
            ContextCompat.startForegroundService(context, intent);
        } catch (RuntimeException ignored) {
            // Android can reject a background foreground-service start after a
            // force-stop or on some OEM boot flows. Opening Sikka again retries.
        }
    }

    public static JSONArray pendingTrips(Context context) {
        synchronized (STORE_LOCK) {
            JSONArray value = readState(context).optJSONArray("pending");
            return value != null ? value : new JSONArray();
        }
    }

    public static boolean acknowledgeTrip(Context context, String id) {
        synchronized (STORE_LOCK) {
            JSONObject state = readState(context);
            JSONArray source = state.optJSONArray("pending");
            JSONArray kept = new JSONArray();
            boolean removed = false;
            if (source != null) {
                for (int i = 0; i < source.length(); i++) {
                    JSONObject trip = source.optJSONObject(i);
                    if (trip != null && id.equals(trip.optString("id"))) removed = true;
                    else if (trip != null) kept.put(trip);
                }
            }
            try { state.put("pending", kept); } catch (JSONException ignored) {}
            if (instance != null) instance.pending = kept;
            writeState(context, state);
            return removed;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        restore();
        createChannel();
        startAsForeground(recording ? "Recording a possible transit ride" : "Watching for bus and microbus rides");
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        requestUpdates();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!isEnabled(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        requestUpdates();
        return START_STICKY;
    }

    private void requestUpdates() {
        if (locationManager == null) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return;
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, UPDATE_MS, 5f, this);
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 15_000L, 15f, this);
            }
        } catch (SecurityException | IllegalArgumentException ignored) {}
    }

    @Override
    public void onLocationChanged(Location location) {
        if (location == null || (location.hasAccuracy() && location.getAccuracy() > MAX_ACCURACY_METERS)) return;
        long now = location.getTime() > 0 ? location.getTime() : System.currentTimeMillis();
        float speed = location.hasSpeed() ? Math.max(0f, location.getSpeed()) : derivedSpeed(location, now);
        JSONObject point = pointOf(location, now, speed);

        trimRecent(now);
        recent.put(point);
        boolean moving = speed >= START_SPEED_MPS;
        movingFixes = moving ? Math.min(6, movingFixes + 1) : Math.max(0, movingFixes - 1);

        if (!recording && movingFixes >= 3) {
            recording = true;
            active = copyArray(recent);
            activeDistanceMeters = distanceOf(active);
            stoppedSince = 0L;
            updateNotification("Recording a possible transit ride");
        } else if (recording) {
            appendUnique(active, point);
            if (lastLocation != null) activeDistanceMeters += lastLocation.distanceTo(location);
            if (speed <= STOP_SPEED_MPS) {
                if (stoppedSince == 0L) stoppedSince = now;
                if (now - stoppedSince >= STOP_WINDOW_MS) finishDetectedTrip(now);
            } else {
                stoppedSince = 0L;
            }
        }
        lastLocation = new Location(location);
        persist();
    }

    private void finishDetectedTrip(long now) {
        long start = active.length() > 0 ? active.optJSONObject(0).optLong("timestamp", now) : now;
        boolean valid = active.length() >= 8 && now - start >= MIN_TRIP_MS && activeDistanceMeters >= MIN_TRIP_METERS;
        if (valid) {
            JSONObject trip = new JSONObject();
            try {
                trip.put("id", UUID.randomUUID().toString());
                trip.put("detectedAt", now);
                trip.put("startedAt", start);
                trip.put("endedAt", active.optJSONObject(active.length() - 1).optLong("timestamp", now));
                trip.put("distanceMeters", Math.round(activeDistanceMeters));
                JSONArray trace = new JSONArray();
                JSONArray timestamps = new JSONArray();
                for (int i = 0; i < active.length(); i++) {
                    JSONObject p = active.optJSONObject(i);
                    if (p == null) continue;
                    trace.put(new JSONArray().put(p.optDouble("lng")).put(p.optDouble("lat")));
                    timestamps.put(p.optLong("timestamp"));
                }
                trip.put("trace", trace);
                trip.put("timestamps", timestamps);
                pending.put(trip);
                while (pending.length() > 10) pending.remove(0);
            } catch (JSONException ignored) {}
            updateNotification("Trip detected — tap to identify bus or microbus");
        } else {
            updateNotification("Watching for bus and microbus rides");
        }
        recording = false;
        active = new JSONArray();
        activeDistanceMeters = 0f;
        movingFixes = 0;
        stoppedSince = 0L;
        recent = new JSONArray();
    }

    private float derivedSpeed(Location location, long now) {
        if (lastLocation == null) return 0f;
        long elapsed = Math.max(1L, now - lastLocation.getTime());
        return lastLocation.distanceTo(location) / (elapsed / 1000f);
    }

    private JSONObject pointOf(Location location, long now, float speed) {
        JSONObject point = new JSONObject();
        try {
            point.put("lng", location.getLongitude());
            point.put("lat", location.getLatitude());
            point.put("timestamp", now);
            point.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : JSONObject.NULL);
            point.put("speed", speed);
        } catch (JSONException ignored) {}
        return point;
    }

    private void trimRecent(long now) {
        JSONArray kept = new JSONArray();
        for (int i = 0; i < recent.length(); i++) {
            JSONObject point = recent.optJSONObject(i);
            if (point != null && now - point.optLong("timestamp", now) <= RECENT_WINDOW_MS) kept.put(point);
        }
        recent = kept;
    }

    private void appendUnique(JSONArray array, JSONObject point) {
        JSONObject previous = array.optJSONObject(array.length() - 1);
        if (previous == null || point.optLong("timestamp") > previous.optLong("timestamp")) array.put(point);
        if (array.length() > 8_000) {
            JSONArray compact = new JSONArray();
            for (int i = 0; i < array.length(); i += 2) compact.put(array.opt(i));
            active = compact;
        }
    }

    private float distanceOf(JSONArray points) {
        float total = 0f;
        float[] out = new float[1];
        for (int i = 1; i < points.length(); i++) {
            JSONObject a = points.optJSONObject(i - 1);
            JSONObject b = points.optJSONObject(i);
            if (a == null || b == null) continue;
            Location.distanceBetween(a.optDouble("lat"), a.optDouble("lng"), b.optDouble("lat"), b.optDouble("lng"), out);
            total += out[0];
        }
        return total;
    }

    private JSONArray copyArray(JSONArray source) {
        try { return new JSONArray(source.toString()); } catch (JSONException ignored) { return new JSONArray(); }
    }

    private void restore() {
        synchronized (STORE_LOCK) {
            JSONObject state = readState(this);
            recent = state.optJSONArray("recent") != null ? state.optJSONArray("recent") : new JSONArray();
            active = state.optJSONArray("active") != null ? state.optJSONArray("active") : new JSONArray();
            pending = state.optJSONArray("pending") != null ? state.optJSONArray("pending") : new JSONArray();
            recording = state.optBoolean("recording", false) && active.length() > 0;
            movingFixes = state.optInt("movingFixes", 0);
            stoppedSince = state.optLong("stoppedSince", 0L);
            activeDistanceMeters = (float) state.optDouble("activeDistanceMeters", distanceOf(active));
        }
    }

    private void persist() {
        JSONObject state = new JSONObject();
        try {
            state.put("recent", recent);
            state.put("active", active);
            state.put("pending", pending);
            state.put("recording", recording);
            state.put("movingFixes", movingFixes);
            state.put("stoppedSince", stoppedSince);
            state.put("activeDistanceMeters", activeDistanceMeters);
        } catch (JSONException ignored) {}
        synchronized (STORE_LOCK) { writeState(this, state); }
    }

    private static JSONObject readState(Context context) {
        AtomicFile file = new AtomicFile(new File(context.getFilesDir(), STATE_FILE));
        if (!file.getBaseFile().exists()) return new JSONObject();
        try (FileInputStream stream = file.openRead()) {
            byte[] data = new byte[(int) file.getBaseFile().length()];
            int read = stream.read(data);
            return read > 0 ? new JSONObject(new String(data, 0, read, StandardCharsets.UTF_8)) : new JSONObject();
        } catch (Exception ignored) { return new JSONObject(); }
    }

    private static void writeState(Context context, JSONObject state) {
        AtomicFile file = new AtomicFile(new File(context.getFilesDir(), STATE_FILE));
        FileOutputStream stream = null;
        try {
            stream = file.startWrite();
            stream.write(state.toString().getBytes(StandardCharsets.UTF_8));
            file.finishWrite(stream);
        } catch (Exception error) {
            if (stream != null) file.failWrite(stream);
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Automatic route discovery", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Keeps GPS route discovery running when Sikka is closed or in the background.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private Notification notification(String text) {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 4219, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.sikka_app_icon)
            .setContentTitle("Sikka is collecting trip data")
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(pendingIntent)
            .build();
    }

    private void startAsForeground(String text) {
        Notification value = notification(text);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, value, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        else startForeground(NOTIFICATION_ID, value);
    }

    private void updateNotification(String text) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, notification(text));
    }

    @Override
    public void onProviderEnabled(String provider) { requestUpdates(); }

    @Override
    public void onProviderDisabled(String provider) {}

    @SuppressWarnings("deprecation")
    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {}

    @Override
    public void onDestroy() {
        persist();
        if (locationManager != null) locationManager.removeUpdates(this);
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }
}
