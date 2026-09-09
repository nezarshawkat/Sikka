import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const apiGet = vi.fn();
const showInterstitial = vi.fn();

vi.mock('@/lib/api', () => ({
  api: { get: apiGet },
}));

vi.mock('@/lib/adMob', () => ({
  showInterstitialAd: showInterstitial,
}));

describe('showConfiguredAd', () => {
  beforeEach(() => {
    vi.resetModules();
    apiGet.mockReset();
    showInterstitial.mockReset();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('falls back to the default ad config when the server config cannot load', async () => {
    apiGet.mockRejectedValue(new Error('offline'));

    const { showConfiguredAd } = await import('./appConfig');
    await showConfiguredAd('location_loaded');

    expect(showInterstitial).toHaveBeenCalledWith('location_loaded');
  });

  it('does not hang placements when the config endpoint stalls', async () => {
    vi.useFakeTimers();
    apiGet.mockReturnValue(new Promise(() => {}));
    const { showConfiguredAd } = await import('./appConfig');
    const request = showConfiguredAd('trip_review_complete');
    await vi.advanceTimersByTimeAsync(2001);
    await request;
    expect(showInterstitial).toHaveBeenCalledWith('trip_review_complete');
  });

  it('honors the global and individual placement switches', async () => {
    const { showConfiguredAd } = await import('./appConfig');
    apiGet.mockResolvedValueOnce({ adsEnabled: false });
    await showConfiguredAd('location_loaded');
    apiGet.mockResolvedValueOnce({ showAdAfterTripReview: false });
    await showConfiguredAd('trip_review_complete');
    expect(showInterstitial).not.toHaveBeenCalled();
  });

  it('deduplicates a successful location ad but permits the end-of-trip ad', async () => {
    apiGet.mockResolvedValue({});
    showInterstitial.mockResolvedValue(true);
    const { showConfiguredAd } = await import('./appConfig');
    await showConfiguredAd('location_loaded');
    await showConfiguredAd('location_loaded');
    await showConfiguredAd('trip_review_complete');
    expect(showInterstitial.mock.calls.map(call => call[0])).toEqual(['location_loaded', 'trip_review_complete']);
  });

  it('allows a later location attempt if the first ad was unavailable', async () => {
    apiGet.mockResolvedValue({});
    showInterstitial.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { showConfiguredAd } = await import('./appConfig');
    await showConfiguredAd('location_loaded');
    await showConfiguredAd('location_loaded');
    expect(showInterstitial).toHaveBeenCalledTimes(2);
  });

  it('does not display a delayed placement after backgrounding', async () => {
    apiGet.mockResolvedValue({});
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    const { showConfiguredAd } = await import('./appConfig');
    await showConfiguredAd('location_loaded');
    expect(showInterstitial).not.toHaveBeenCalled();
  });
});
