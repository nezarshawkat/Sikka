package com.sikkago.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class SikkaBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())
            || Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            SikkaDiscoveryService.ensureStarted(context);
        }
    }
}
