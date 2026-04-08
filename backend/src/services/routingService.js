import { findRouteScenarios } from '../../../routing_engine/src/scoring/routePlanner.js';

export function planRoutes({ start, end, routeType }) {
  return findRouteScenarios(start, end, routeType);
}
