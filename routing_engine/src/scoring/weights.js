export const routeTypeWeights = {
  cheapest: { cost: 0.7, time: 0.2, transfers: 0.1, comfort: 0, safety: 0 },
  fastest: { cost: 0.1, time: 0.8, transfers: 0.1, comfort: 0, safety: 0 },
  balanced: { cost: 0.35, time: 0.35, transfers: 0.15, comfort: 0.1, safety: 0.05 },
  comfort: { cost: 0.2, time: 0.2, transfers: 0.05, comfort: 0.45, safety: 0.1 },
  tourist: { cost: 0.1, time: 0.2, transfers: 0.05, comfort: 0.25, safety: 0.4 }
};

export function resolveWeights(routeType) {
  return routeTypeWeights[routeType] ?? routeTypeWeights.balanced;
}
