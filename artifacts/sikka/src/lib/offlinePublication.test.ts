import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ types: [] as any[], lines: [] as any[], heatmaps: [] as any[] }));
vi.mock('@workspace/db', () => ({
  transportTypesTable: { key: 'types' }, transitLinesTable: { key: 'lines' }, transportHeatmapsTable: { key: 'heatmaps' },
  db: { select: () => ({ from: (table: { key: keyof typeof state }) => {
    const query = { where: () => query, orderBy: async () => state[table.key].filter(row => row.isActive !== false) };
    return query;
  } }) },
}));
vi.mock('drizzle-orm', () => ({ asc: vi.fn(), eq: vi.fn() }));

beforeEach(() => {
  state.types = [{ id: 'bus', nameEn: 'Bus', createdAt: new Date(100) }];
  state.heatmaps = [];
  state.lines = [{ id: 'r', transportTypeId: 'bus', routeStatus: 'active', isActive: true, dataSource: 'discovery', routeDirection: 'reverse', priceEgp: 5, updatedAt: new Date(200), routePath: { type: 'LineString', coordinates: [[31.23, 30.04], [31.231, 30.04]] } }];
});

describe('published backend snapshot', () => {
  it('exports accepted geometry, fare and direction to every client', async () => {
    const { buildOfflinePayload } = await import('../../../api-server/src/routes/offlineSnapshot');
    const payload = await buildOfflinePayload();
    expect(payload.lines[0]).toMatchObject({ id: 'r', priceEgp: 5, routeDirection: 'reverse', path: [[31.23, 30.04], [31.231, 30.04]] });
  });
  it('changes revision for edits even when the maximum timestamp is unchanged', async () => {
    const { buildOfflinePayload } = await import('../../../api-server/src/routes/offlineSnapshot');
    const before = await buildOfflinePayload();
    state.lines[0].priceEgp = 17;
    const after = await buildOfflinePayload();
    expect(after.revision).not.toBe(before.revision);
    expect(after.lines[0].priceEgp).toBe(17);
  });
  it('excludes rejected, disabled, pending, and geometry-less routes', async () => {
    const { buildOfflinePayload } = await import('../../../api-server/src/routes/offlineSnapshot');
    const line = state.lines[0];
    state.lines.push(
      { ...line, id: 'rejected', routeStatus: 'rejected' },
      { ...line, id: 'disabled', isActive: false },
      { ...line, id: 'pending', routeStatus: 'needs_review' },
      { ...line, id: 'empty', routePath: null },
    );
    expect((await buildOfflinePayload()).lines.map(row => row.id)).toEqual(['r']);
  });
  it('changes revision and membership when the newest route is deleted', async () => {
    const { buildOfflinePayload } = await import('../../../api-server/src/routes/offlineSnapshot');
    const before = await buildOfflinePayload();
    state.lines = [];
    const after = await buildOfflinePayload();
    expect(after.revision).not.toBe(before.revision);
    expect(after.lines).toEqual([]);
    expect(after.activeLineIds).toEqual([]);
  });
});
