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
  adsEnabled: false,
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
  try {
    const config = await getMobileAppConfig();
    const placementEnabled = placement === "location_loaded"
      ? config.showAdAfterLocation
      : config.showAdAfterTripReview;
    if (config.adsEnabled && placementEnabled) await showInterstitialAd(placement);
  } catch {
    // Advertising must never block location use or review submission.
  }
}
