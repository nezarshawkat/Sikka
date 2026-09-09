import { Capacitor, registerPlugin } from "@capacitor/core";

export type AdPlacement = "location_loaded" | "trip_review_complete";

type NativeAdMobPlugin = {
  showInterstitial(options: { placement: AdPlacement }): Promise<{ shown: boolean; reason?: string }>;
  preload(): Promise<void>;
};

const SikkaAdMob = registerPlugin<NativeAdMobPlugin>("SikkaAdMob");

/** Shows the preloaded native AdMob interstitial when one is ready. */
export async function showInterstitialAd(placement: AdPlacement): Promise<boolean> {
  const platform = Capacitor.getPlatform();
  if (platform !== "android") {
    console.log(`[SikkaAdMob] Platform is ${platform}; native interstitial skipped`);
    return false;
  }
  console.log('[SikkaAdMob] Platform is Android; requesting interstitial', placement);
  try {
    console.log('[SikkaAdMob] Loading/showing interstitial', placement);
    const result = await SikkaAdMob.showInterstitial({ placement });
    if (result.shown) console.log('[SikkaAdMob] Ad load/show event succeeded', placement);
    else console.log('[SikkaAdMob] Ad load/show event failed', placement, result.reason ?? 'unavailable');
    return result.shown;
  } catch (error) {
    console.error('[SikkaAdMob] Ad load/show event failed', error);
    // An unavailable ad must never interrupt location or trip completion.
    return false;
  }
}

export function preloadInterstitialAd(): void {
  const platform = Capacitor.getPlatform();
  if (platform !== "android") {
    console.log(`[SikkaAdMob] Platform is ${platform}; native initialization skipped`);
    return;
  }
  console.log('[SikkaAdMob] Platform is Android; initializing native AdMob preload');
  void SikkaAdMob.preload()
    .then(() => console.log('[SikkaAdMob] Native AdMob initialization/preload completed'))
    .catch((error) => console.error('[SikkaAdMob] Ad load event failed', error));
}
