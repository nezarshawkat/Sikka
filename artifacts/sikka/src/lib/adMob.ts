import { Capacitor, registerPlugin } from "@capacitor/core";

export type AdPlacement = "location_loaded" | "trip_review_complete";

type NativeAdMobPlugin = {
  showInterstitial(options: { placement: AdPlacement }): Promise<{ shown: boolean }>;
  preload(): Promise<void>;
};

const SikkaAdMob = registerPlugin<NativeAdMobPlugin>("SikkaAdMob");

/** Shows the preloaded native AdMob interstitial when one is ready. */
export async function showInterstitialAd(placement: AdPlacement): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  try {
    await SikkaAdMob.showInterstitial({ placement });
    void SikkaAdMob.preload();
  } catch {
    // An unavailable ad must never interrupt location or trip completion.
  }
}

export function preloadInterstitialAd(): void {
  if (Capacitor.getPlatform() === "android") void SikkaAdMob.preload().catch(() => {});
}
