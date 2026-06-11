package com.sikkago.app;

import android.app.PictureInPictureParams;
import android.os.Bundle;
import android.os.Build;
import android.util.Rational;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SikkaTripNotificationPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && SikkaTripNotificationPlugin.hasActiveTrip()) {
            PictureInPictureParams params = new PictureInPictureParams.Builder()
                .setAspectRatio(new Rational(9, 16))
                .build();
            enterPictureInPictureMode(params);
        }
    }
}
