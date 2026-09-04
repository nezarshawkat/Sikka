package com.sikkago.app;

import android.app.Activity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.interstitial.InterstitialAd;
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback;

/** Native AdMob bridge. An ad is preloaded so a placement never delays route UI. */
@CapacitorPlugin(name = "SikkaAdMob")
public class SikkaAdMobPlugin extends Plugin {
    private static final String INTERSTITIAL_UNIT_ID = "ca-app-pub-2875822124723194/1780888432";
    private InterstitialAd interstitialAd;
    private boolean initialized = false;
    private boolean loading = false;

    @Override
    public void load() {
        super.load();
        MobileAds.initialize(getContext(), status -> loadInterstitial());
        initialized = true;
    }

    private void loadInterstitial() {
        if (loading || interstitialAd != null) return;
        loading = true;
        InterstitialAd.load(getContext(), INTERSTITIAL_UNIT_ID, new AdRequest.Builder().build(), new InterstitialAdLoadCallback() {
            @Override public void onAdLoaded(InterstitialAd ad) { loading = false; interstitialAd = ad; }
            @Override public void onAdFailedToLoad(com.google.android.gms.ads.LoadAdError error) { loading = false; interstitialAd = null; }
        });
    }

    @PluginMethod
    public void showInterstitial(PluginCall call) {
        Activity activity = getActivity();
        InterstitialAd ad = interstitialAd;
        interstitialAd = null;
        loadInterstitial();
        if (activity == null || ad == null || activity.isFinishing()) {
            JSObject result = new JSObject(); result.put("shown", false); call.resolve(result);
            return;
        }
        ad.setFullScreenContentCallback(new FullScreenContentCallback() {
            @Override public void onAdDismissedFullScreenContent() { loadInterstitial(); }
            @Override public void onAdFailedToShowFullScreenContent(com.google.android.gms.ads.AdError error) { loadInterstitial(); }
        });
        ad.show(activity);
        JSObject result = new JSObject(); result.put("shown", true); call.resolve(result);
    }

    @PluginMethod
    public void preload(PluginCall call) {
        if (!initialized) MobileAds.initialize(getContext(), status -> loadInterstitial());
        else loadInterstitial();
        call.resolve();
    }
}
