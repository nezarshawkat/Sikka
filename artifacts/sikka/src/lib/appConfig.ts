import { api } from "@/lib/api";
import { showInterstitialAd, type AdPlacement } from "@/lib/adMob";

export interface MobileAppConfig {
  adsEnabled: boolean;
  showAdAfterLocation: boolean;
  showAdAfterTripReview: boolean;
  minimumAndroidVersion: number | null;
  playStoreUrl: string;
}

export const DEFAULT_APP_CONFIG: MobileAppConfig = {
  adsEnabled: true,
  showAdAfterLocation: true,
  showAdAfterTripReview: true,
  minimumAndroidVersion: null,
  playStoreUrl: "",
};

export async function getMobileAppConfig(): Promise<MobileAppConfig> {
  const config = await api.get<Partial<MobileAppConfig>>("/app-config");
  return { ...DEFAULT_APP_CONFIG, ...config };
}

export async function showConfiguredAd(placement: AdPlacement): Promise<void> {
  let config = { ...DEFAULT_APP_CONFIG };

  try {
    config = await getMobileAppConfig();
  } catch {
    // The app should still show a single ad when the server config is temporarily
    // unavailable; default policy keeps the release experience working while
    // preserving the ability to disable ads centrally when the API is reachable.
  }

  const placementEnabled = placement === "location_loaded"
    ? config.showAdAfterLocation
    : config.showAdAfterTripReview;

  if (config.adsEnabled && placementEnabled) {
    await showInterstitialAd(placement);
  }
}
