package com.sikkago.app;

import android.app.PictureInPictureParams;
import android.content.Intent;
import android.content.res.Configuration;
import android.os.Bundle;
import android.os.Build;
import android.util.Rational;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SikkaTripNotificationPlugin.class);
        registerPlugin(SikkaLocationSettingsPlugin.class);
        registerPlugin(SikkaDiscoveryPlugin.class);
        registerPlugin(SikkaMapUiPlugin.class);
        registerPlugin(SikkaSharePlugin.class);
        registerPlugin(SikkaRatePlugin.class);
        registerPlugin(SikkaAppInfoPlugin.class);
        registerPlugin(SikkaAdMobPlugin.class);
        super.onCreate(savedInstanceState);
        SikkaDiscoveryService.setEnabled(this, false);
        stopService(new Intent(this, SikkaDiscoveryService.class));
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (!SikkaMapUiPlugin.isTripPipEnabled(this) || isInPictureInPictureMode()) return;
        try {
            PictureInPictureParams params = new PictureInPictureParams.Builder()
                .setAspectRatio(new Rational(9, 16))
                .build();
            enterPictureInPictureMode(params);
        } catch (IllegalStateException ignored) {
            // Some OEM builds reject PiP during transient lifecycle states.
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        notifyPipMode(isInPictureInPictureMode);
    }

    private void notifyPipMode(boolean active) {
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) return;
        String script = "window.dispatchEvent(new CustomEvent('sikka:pipchange',{detail:{active:" + active + "}}));";
        bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(script, null));
    }
}
