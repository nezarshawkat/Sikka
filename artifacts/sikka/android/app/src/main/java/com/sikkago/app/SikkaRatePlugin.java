package com.sikkago.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.review.ReviewInfo;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

@CapacitorPlugin(name = "SikkaRate")
public class SikkaRatePlugin extends Plugin {
    private static final String PACKAGE_NAME = "sikka.app";

    /**
     * Google Play's own in-app review flow: shows Play's native star-rating
     * overlay without leaving the app. Per Google's own Play In-App Review
     * API policy, this app cannot see or influence what star count (if any)
     * the rider picks, and cannot know for certain whether Play actually
     * displayed the dialog (Play silently limits how often it shows this
     * to any one user, by design, to prevent exactly the kind of prompting
     * abuse a "no errors, always works" flow could otherwise become).
     * Resolves {requested:true} once the flow has been asked for and run
     * to completion either way -- that's the signal to mark the rider as
     * having gone through the rating flow, not proof a review was posted.
     */
    @PluginMethod
    public void requestInAppReview(PluginCall call) {
        if (getActivity() == null) {
            call.resolve(resultFor(false));
            return;
        }
        ReviewManager manager = ReviewManagerFactory.create(getContext());
        manager.requestReviewFlow().addOnCompleteListener(task -> {
            if (!task.isSuccessful() || getActivity() == null) {
                call.resolve(resultFor(false));
                return;
            }
            ReviewInfo reviewInfo = task.getResult();
            manager.launchReviewFlow(getActivity(), reviewInfo).addOnCompleteListener(flowTask -> {
                // launchReviewFlow's own completion carries no information
                // about whether the dialog actually appeared or what the
                // rider did with it -- that's intentional on Google's part.
                call.resolve(resultFor(true));
            });
        });
    }

    /**
     * Opens this app's Play Store listing directly in the Play Store app
     * (via the market: scheme) so the rider lands straight on the review
     * section, falling back to the regular https listing page (in
     * whatever browser/app handles it) if the Play Store app isn't
     * available to resolve market: itself.
     */
    @PluginMethod
    public void openPlayStoreListing(PluginCall call) {
        try {
            Intent marketIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + PACKAGE_NAME));
            marketIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(marketIntent);
            call.resolve(resultFor(true));
        } catch (ActivityNotFoundException e) {
            try {
                Intent webIntent = new Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse("https://play.google.com/store/apps/details?id=" + PACKAGE_NAME)
                );
                webIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(webIntent);
                call.resolve(resultFor(true));
            } catch (Exception fallbackError) {
                call.resolve(resultFor(false));
            }
        }
    }

    private JSObject resultFor(boolean requested) {
        JSObject result = new JSObject();
        result.put("requested", requested);
        return result;
    }
}
