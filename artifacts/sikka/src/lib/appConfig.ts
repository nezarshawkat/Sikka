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

let adInFlight = false;
let locationAdShown = false;
let lastKnownConfig = { ...DEFAULT_APP_CONFIG };

async function requestConfiguredAd(placement: AdPlacement): Promise<void> {
  let config = lastKnownConfig;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    config = await Promise.race([
      getMobileAppConfig(),
      new Promise<MobileAppConfig>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Ad config timed out')), 2000);
      }),
    ]);
    lastKnownConfig = config;
  } catch {
    // The app should still show a single ad when the server config is temporarily
    // unavailable; default policy keeps the release experience working while
    // preserving the ability to disable ads centrally when the API is reachable.
  } finally { clearTimeout(timeout); }

  const placementEnabled = placement === "location_loaded"
    ? config.showAdAfterLocation
    : config.showAdAfterTripReview;

  if (config.adsEnabled && placementEnabled) {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const shown = await showInterstitialAd(placement);
    if (shown && placement === 'location_loaded') locationAdShown = true;
  }
}

export async function showConfiguredAd(placement: AdPlacement): Promise<void> {
  if (adInFlight || (placement === 'location_loaded' && locationAdShown)) return;
  adInFlight = true;
  try { await requestConfiguredAd(placement); }
  finally { adInFlight = false; }
}
