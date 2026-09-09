import { describe, expect, it } from 'vitest';
import { routeUpdateForPublication } from '../../../api-server/src/utils/routePublication';

const current = { isActive: false, routeStatus: 'rejected' as const, routePath: { type: 'LineString', coordinates: [[31, 30], [31.1, 30.1]] } };
describe('admin route publication', () => {
  it('accepting a previously disabled route activates it for every device', () => {
    expect(routeUpdateForPublication(current, { routeStatus: 'active' })).toEqual({ isActive: true, routeStatus: 'active' });
  });
  it('synchronizes deactivation and reactivation from the route editor', () => {
    expect(routeUpdateForPublication({ ...current, isActive: true, routeStatus: 'active' }, { isActive: false })).toEqual({ isActive: false, routeStatus: 'inactive' });
    expect(routeUpdateForPublication({ ...current, routeStatus: 'inactive' }, { isActive: true })).toEqual({ isActive: true, routeStatus: 'active' });
  });
  it('rejects missing, degenerate and invalid geometry before acceptance', () => {
    for (const routePath of [null, { type: 'LineString', coordinates: [[31, 30]] }, { type: 'LineString', coordinates: [[31, 30], [31, 30]] }, { type: 'LineString', coordinates: [[31, 30], [181, 30]] }]) {
      expect(() => routeUpdateForPublication({ ...current, routePath }, { routeStatus: 'active' })).toThrow();
    }
  });
});
