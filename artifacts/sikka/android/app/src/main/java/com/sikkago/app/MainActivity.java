package com.sikkago.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SikkaTripNotificationPlugin.class);
        registerPlugin(SikkaLocationSettingsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
