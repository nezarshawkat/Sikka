type RouteStatus = 'active' | 'needs_review' | 'inactive' | 'pending_discovery' | 'rejected';
type RouteState = { routePath: unknown; routeStatus: RouteStatus; isActive: boolean };
const statuses = new Set<RouteStatus>(['active', 'needs_review', 'inactive', 'pending_discovery', 'rejected']);

export function validRouteGeometry(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  if (geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) return false;
  const points = geometry.coordinates;
  return points.every(point => Array.isArray(point) && point.length >= 2
    && Number.isFinite(point[0]) && Number.isFinite(point[1])
    && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)
    && points.some(point => point[0] !== points[0][0] || point[1] !== points[0][1]);
}

/** Keep the two database publication flags consistent on admin writes. */
export function routeUpdateForPublication(current: RouteState, changes: Record<string, unknown>): { routeStatus: RouteStatus; isActive: boolean } {
  let status = current.routeStatus;
  let active = current.isActive;
  if (changes.routeStatus !== undefined) {
    if (!statuses.has(changes.routeStatus as RouteStatus)) throw new Error('Invalid route status');
    status = changes.routeStatus as RouteStatus;
    active = status === 'active' || status === 'needs_review';
  } else if (changes.isActive !== undefined) {
    if (typeof changes.isActive !== 'boolean') throw new Error('isActive must be a boolean');
    active = changes.isActive;
    if (!active) status = 'inactive';
    else if (status === 'inactive' || status === 'rejected' || status === 'pending_discovery') status = 'active';
  }
  const geometry = changes.routePath === undefined ? current.routePath : changes.routePath;
  if (changes.routePath != null && !validRouteGeometry(changes.routePath)) {
    throw new Error('Route geometry must contain at least two distinct valid longitude/latitude points');
  }
  if (status === 'active' && !validRouteGeometry(geometry)) {
    throw new Error('Draw or repair this route before publishing it');
  }
  return { routeStatus: status, isActive: active };
}
