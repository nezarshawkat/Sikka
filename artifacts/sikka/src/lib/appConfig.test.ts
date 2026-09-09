import { describe, expect, it, vi, beforeEach } from 'vitest';

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
    apiGet.mockReset();
    showInterstitial.mockReset();
  });

  it('falls back to the default ad config when the server config cannot load', async () => {
    apiGet.mockRejectedValue(new Error('offline'));

    const { showConfiguredAd } = await import('./appConfig');
    await showConfiguredAd('location_loaded');

    expect(showInterstitial).toHaveBeenCalledWith('location_loaded');
  });
});
