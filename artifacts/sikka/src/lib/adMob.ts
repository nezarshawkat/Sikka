export type AdPlacement = "location_loaded" | "trip_review_complete";

/**
 * SDK-independent placement bridge.  When the AdMob Capacitor SDK is added,
 * replace this event listener with its interstitial load/show calls. Keeping
 * scheduling here prevents ad code from being spread through trip UI flows.
 */
export async function showInterstitialAd(placement: AdPlacement): Promise<void> {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("sikka:show-interstitial-ad", { detail: { placement } }));
}
