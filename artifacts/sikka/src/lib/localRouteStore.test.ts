import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ apiFetch }));

const type = { id: 'bus', nameEn: 'Bus', nameAr: 'Bus', icon: 'bus', color: '#123456', category: 'public', governmentType: 'government', averageSpeedKmh: 30, basePriceEgp: 5, pricePerKmEgp: 0 };
const line = { id: 'accepted', transportTypeId: 'bus', nameEn: 'Published route', nameAr: 'Published route', lineNumber: '1', fromArea: 'A', toArea: 'B', governorate: 'Cairo', routeStatus: 'active', dataSource: 'discovery', viaStops: [], priceEgp: 9, frequencyMinutes: 5, hasFixedStops: false, path: [[31.23, 30.04], [31.24, 30.04], [31.25, 30.04], [31.26, 30.04]] };
const snapshot = (revision = '3-200-new', lines = [line]) => ({ schemaVersion: 3, generatedAt: '2026-09-09T00:00:00Z', revision, types: [type], lines });

beforeEach(() => {
  vi.resetModules();
  apiFetch.mockReset();
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), setTimeout, clearTimeout });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline test')));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('route synchronization', () => {
  it('accepts the server after deletion lowers its timestamp, including an empty catalog', async () => {
    const store = await import('./localRouteStore');
    apiFetch.mockResolvedValueOnce(snapshot('3-900-old'));
    await store.refreshLocalRouteSnapshot(true);
    apiFetch.mockResolvedValueOnce(snapshot('3-100-deleted', []));
    await store.refreshLocalRouteSnapshot(true);
    expect((await store.getLocalRouteCatalog()).routes).toEqual([]);
    expect((await store.readSnapshot()).revision).toBe('3-100-deleted');
  });

  it('keeps a downloaded snapshot ahead of a newer bundled timestamp', async () => {
    const { pickLatestSnapshot } = await import('./localRouteStore');
    const remote = { ...snapshot('3-100-remote'), authoritative: true } as any;
    expect(pickLatestSnapshot(remote, snapshot('3-999-bundle') as any)).toBe(remote);
  });

  it('keeps the last working routes when the network fails or the payload is malformed', async () => {
    const store = await import('./localRouteStore');
    apiFetch.mockResolvedValueOnce(snapshot());
    await store.refreshLocalRouteSnapshot(true);
    apiFetch.mockRejectedValueOnce(new Error('offline'));
    await store.refreshLocalRouteSnapshot(true);
    apiFetch.mockResolvedValueOnce({ ...snapshot(), types: null });
    await store.refreshLocalRouteSnapshot(true);
    expect((await store.readSnapshot()).lines[0].id).toBe('accepted');
  });

  it('checks only the manifest when data is unchanged', async () => {
    vi.useFakeTimers();
    const store = await import('./localRouteStore');
    apiFetch.mockResolvedValueOnce(snapshot());
    await store.refreshLocalRouteSnapshot(true);
    vi.advanceTimersByTime(30_000);
    apiFetch.mockResolvedValueOnce({ revision: '3-200-new' });
    await store.refreshLocalRouteSnapshot();
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch.mock.calls[1][0]).toBe('/offline/manifest');
  });

  it('remains usable when Android WebView denies IndexedDB storage', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const indexedDB = { open: () => { throw new Error('Storage denied'); } };
    vi.stubGlobal('indexedDB', indexedDB);
    vi.stubGlobal('window', { indexedDB, dispatchEvent: vi.fn(), setTimeout, clearTimeout });
    const store = await import('./localRouteStore');
    await expect(store.readSnapshot()).resolves.toHaveProperty('lines');
    apiFetch.mockResolvedValueOnce(snapshot());
    await store.refreshLocalRouteSnapshot(true);
    expect((await store.readSnapshot()).lines[0].id).toBe('accepted');
    warn.mockRestore();
  });

  it('makes an edit visible to the actual on-device trip planner', async () => {
    const store = await import('./localRouteStore');
    apiFetch.mockResolvedValueOnce(snapshot());
    await store.refreshLocalRouteSnapshot(true);
    const { planTripOnDevice } = await import('./offlineTripPlanner');
    const request = { startLat: 30.04, startLng: 31.23, endLat: 30.04, endLng: 31.26, tripType: 'economic' };
    const before = await planTripOnDevice(request);
    expect(before?.segments.some(segment => segment.line_id === 'accepted')).toBe(true);
    apiFetch.mockResolvedValueOnce(snapshot('3-201-edited', [{ ...line, priceEgp: 17, nameEn: 'Edited route' }]));
    await store.refreshLocalRouteSnapshot(true);
    const after = await planTripOnDevice(request);
    expect(after?.snapshot_revision).toBe('3-201-edited');
    expect(after?.segments.find(segment => segment.line_id === 'accepted')?.cost_egp)
      .toBeGreaterThan(before!.segments.find(segment => segment.line_id === 'accepted')!.cost_egp);
    apiFetch.mockResolvedValueOnce(snapshot('3-100-removed', []));
    await store.refreshLocalRouteSnapshot(true);
    const removed = await planTripOnDevice(request);
    expect(removed?.segments.some(segment => segment.line_id === 'accepted') ?? false).toBe(false);
  });

  it('does not publish pending or rejected discovery routes through local fallback', async () => {
    const store = await import('./localRouteStore');
    apiFetch.mockResolvedValueOnce(snapshot('3-300', [{ ...line, routeStatus: 'rejected' }]));
    await store.refreshLocalRouteSnapshot(true);
    const { planTripOnDevice } = await import('./offlineTripPlanner');
    const plan = await planTripOnDevice({ startLat: 30.04, startLng: 31.23, endLat: 30.04, endLng: 31.26, tripType: 'economic' });
    expect(plan?.segments.some(segment => segment.line_id === 'accepted') ?? false).toBe(false);
  });
});
