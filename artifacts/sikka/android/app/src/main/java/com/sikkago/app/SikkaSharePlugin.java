package com.sikkago.app;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SikkaShare")
public class SikkaSharePlugin extends Plugin {
    @PluginMethod
    public void share(PluginCall call) {
        String title = call.getString("title", "Sikka");
        String text = call.getString("text", "");
        String url = call.getString("url", "");
        String shareText = (text + (url.isEmpty() ? "" : "\n" + url)).trim();

        Intent sendIntent = new Intent(Intent.ACTION_SEND);
        sendIntent.setType("text/plain");
        sendIntent.putExtra(Intent.EXTRA_TITLE, title);
        sendIntent.putExtra(Intent.EXTRA_SUBJECT, title);
        sendIntent.putExtra(Intent.EXTRA_TEXT, shareText.isEmpty() ? url : shareText);

        Intent chooser = Intent.createChooser(sendIntent, title);
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(chooser);

        JSObject result = new JSObject();
        result.put("opened", true);
        call.resolve(result);
    }
}
