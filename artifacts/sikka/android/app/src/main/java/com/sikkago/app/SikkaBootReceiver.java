package com.sikkago.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class SikkaBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        // Always-on discovery no longer starts automatically; foreground
        // background-location services require a persistent system notification.
    }
}
