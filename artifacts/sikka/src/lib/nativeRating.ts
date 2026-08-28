import { Capacitor, registerPlugin } from '@capacitor/core';

type NativeRatePlugin = {
  requestInAppReview(): Promise<{ requested: boolean }>;
  openPlayStoreListing(): Promise<{ requested: boolean }>;
};

const SikkaRate = registerPlugin<NativeRatePlugin>('SikkaRate');

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=sikka.app';

/**
 * Tries Google Play's own in-app review overlay first (stays in the app,
 * Google's own native star UI). This app never sees or sets the star count
 * -- Play's API deliberately doesn't expose that, to prevent apps from
 * gaming their own ratings. Falls back to opening the Play Store listing
 * directly if the native flow isn't available (non-Android, plugin
 * failure, etc.) so the rider can still leave a review either way.
 */
export async function requestAppRating(): Promise<void> {
  if (Capacitor.getPlatform() === 'android') {
    try {
      const result = await SikkaRate.requestInAppReview();
      if (result?.requested) return;
    } catch {
      // fall through to the direct listing
    }
    try {
      await SikkaRate.openPlayStoreListing();
      return;
    } catch {
      // fall through to the web fallback below
    }
  }
  window.open(PLAY_STORE_URL, '_blank', 'noopener,noreferrer');
}
