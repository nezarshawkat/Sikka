package com.sikkago.app;

import static org.junit.Assert.*;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Run on a clean emulator: startup must not require location permission. */
@RunWith(AndroidJUnit4.class)
public class StartupSmokeTest {
    @Test public void coldLaunchRendersAndSurvivesSdkStartup() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            SystemClock.sleep(15_000);
            CountDownLatch checked = new CountDownLatch(1);
            AtomicReference<String> rendered = new AtomicReference<>();
            scenario.onActivity(activity -> {
                assertNotNull(activity.getBridge());
                assertNotNull(activity.getBridge().getWebView());
                assertFalse(activity.isFinishing());
                activity.getBridge().getWebView().evaluateJavascript(
                    "Boolean(document.getElementById('root')?.children.length)", value -> {
                        rendered.set(value);
                        checked.countDown();
                    });
            });
            assertTrue(checked.await(10, TimeUnit.SECONDS));
            assertEquals("true", rendered.get());
        }
    }

    @Test public void adCallsFromBridgeThreadResolveWithoutCrashing() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<SikkaAdMobPlugin> plugin = new AtomicReference<>();
            scenario.onActivity(activity -> plugin.set((SikkaAdMobPlugin) activity.getBridge().getPlugin("SikkaAdMob").getInstance()));
            CountDownLatch preloaded = new CountDownLatch(1);
            CountDownLatch shown = new CountDownLatch(1);
            AtomicReference<JSObject> result = new AtomicReference<>();
            // Instrumentation runs off the UI thread, just like bridge methods.
            plugin.get().preload(new PluginCall(null, "SikkaAdMob", "test-preload", "preload", new JSObject()) {
                @Override public void resolve() { preloaded.countDown(); }
            });
            assertTrue(preloaded.await(15, TimeUnit.SECONDS));
            plugin.get().showInterstitial(new PluginCall(null, "SikkaAdMob", "test-show", "showInterstitial", new JSObject()) {
                @Override public void resolve(JSObject value) { result.set(value); shown.countDown(); }
            });
            assertTrue("Ad request must resolve even without inventory", shown.await(15, TimeUnit.SECONDS));
            assertTrue(result.get().has("shown"));
            assertTrue(result.get().has("reason"));
        }
    }
}
