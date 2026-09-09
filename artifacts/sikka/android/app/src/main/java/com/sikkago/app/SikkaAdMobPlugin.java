package com.sikkago.app;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.interstitial.InterstitialAd;
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback;

/** All SDK calls and mutable ad state belong to the Android main thread. */
@CapacitorPlugin(name = "SikkaAdMob")
public class SikkaAdMobPlugin extends Plugin {
    private static final String TAG = "SikkaAdMob";
    private static final String LIVE_UNIT = "ca-app-pub-2875822124723194/1780888432";
    private static final String TEST_UNIT = "ca-app-pub-3940256099942544/1033173712";
    private static final long MAX_AGE_MS = 55 * 60_000L;
    private final Handler main = new Handler(Looper.getMainLooper());
    private InterstitialAd ad;
    private PluginCall pending;
    private boolean initializing, initialized, loading, showing, destroyed;
    private long loadedAt;
    private int failures;
    private final Runnable placementTimeout = () -> finish(false, "not_ready");
    private final Runnable retry = () -> { if (canShow()) prepare(); };

    // No SDK initialization in Plugin.load(): the bridge is still being built.
    @PluginMethod
    public void preload(PluginCall call) {
        main.post(() -> { prepare(); call.resolve(); });
    }

    private boolean canShow() {
        Activity activity = getActivity();
        return !destroyed && activity != null && !activity.isFinishing()
            && !activity.isDestroyed()
            && getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)
            && !(android.os.Build.VERSION.SDK_INT >= 26 && activity.isInPictureInPictureMode());
    }

    private void prepare() {
        if (destroyed || showing) return;
        try {
            if (!initialized) {
                if (initializing || !canShow()) return;
                initializing = true;
                MobileAds.initialize(getContext(), status -> main.post(() -> {
                    initializing = false;
                    if (destroyed) return;
                    initialized = true;
                    loadAd();
                }));
            } else loadAd();
        } catch (RuntimeException error) {
            initializing = false;
            fail("initialize", error.toString());
        }
    }

    private void loadAd() {
        if (destroyed || showing || loading) return;
        if (ad != null && SystemClock.elapsedRealtime() - loadedAt >= MAX_AGE_MS) ad = null;
        if (ad != null) { showReadyAd(); return; }
        loading = true;
        main.removeCallbacks(retry);
        String unit = (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0 ? TEST_UNIT : LIVE_UNIT;
        try {
            InterstitialAd.load(getContext(), unit, new AdRequest.Builder().build(), new InterstitialAdLoadCallback() {
                @Override public void onAdLoaded(InterstitialAd loaded) {
                    main.post(() -> {
                        loading = false;
                        if (destroyed) return;
                        ad = loaded;
                        loadedAt = SystemClock.elapsedRealtime();
                        failures = 0;
                        Log.i(TAG, "Interstitial loaded");
                        showReadyAd();
                    });
                }
                @Override public void onAdFailedToLoad(LoadAdError error) {
                    main.post(() -> fail("load", error.toString()));
                }
            });
        } catch (RuntimeException error) { fail("load", error.toString()); }
    }

    @PluginMethod
    public void showInterstitial(PluginCall call) {
        main.post(() -> {
            if (pending != null || showing) { resolve(call, false, "busy"); return; }
            if (!canShow()) { resolve(call, false, "background"); return; }
            pending = call;
            // A cold request gets a bounded chance at this placement, never
            // an unexpected ad minutes later after loading eventually finishes.
            main.postDelayed(placementTimeout, 8_000L);
            prepare();
        });
    }

    private void showReadyAd() {
        if (ad == null || pending == null || showing) return;
        if (!canShow()) { finish(false, "background"); return; }
        InterstitialAd ready = ad;
        ad = null;
        showing = true;
        main.removeCallbacks(placementTimeout);
        ready.setFullScreenContentCallback(new FullScreenContentCallback() {
            @Override public void onAdShowedFullScreenContent() {
                main.post(() -> finish(true, "shown"));
            }
            @Override public void onAdDismissedFullScreenContent() {
                main.post(() -> { showing = false; prepare(); });
            }
            @Override public void onAdFailedToShowFullScreenContent(AdError error) {
                main.post(() -> { showing = false; fail("show", error.toString()); });
            }
        });
        try { ready.show(getActivity()); }
        catch (RuntimeException error) { showing = false; fail("show", error.toString()); }
    }

    private void fail(String stage, String message) {
        loading = false;
        ad = null;
        Log.w(TAG, stage + ": " + message);
        finish(false, stage + "_failed");
        if (!destroyed) {
            main.removeCallbacks(retry);
            main.postDelayed(retry, Math.min(120_000L, 15_000L * (1L << Math.min(failures++, 3))));
        }
    }

    private void finish(boolean shown, String reason) {
        main.removeCallbacks(placementTimeout);
        PluginCall call = pending;
        pending = null;
        if (call != null) resolve(call, shown, reason);
    }

    private void resolve(PluginCall call, boolean shown, String reason) {
        JSObject result = new JSObject();
        result.put("shown", shown);
        result.put("reason", reason);
        call.resolve(result);
    }

    @Override protected void handleOnPause() {
        main.post(() -> { if (!showing) finish(false, "background"); });
    }

    @Override protected void handleOnResume() {
        main.post(() -> { if (initialized) prepare(); });
    }

    @Override protected void handleOnDestroy() {
        destroyed = true;
        main.removeCallbacksAndMessages(null);
        finish(false, "destroyed");
        ad = null;
    }
}
