import { describe, expect, it } from 'vitest';

describe('pickLatestSnapshot', () => {
  it('prefers the remote snapshot when its revision is newer than the device snapshot', async () => {
    const { pickLatestSnapshot } = await import('./localRouteStore');

    const bundled = { revision: '3-100', lines: [{ id: 'old' }] } as any;
    const remote = { revision: '3-200', lines: [{ id: 'new' }] } as any;

    expect(pickLatestSnapshot(bundled, remote)).toBe(remote);
  });
});
