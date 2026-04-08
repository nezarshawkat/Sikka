export function scoreRoute(metrics, routeType) {
  const { cost, time, transfers, comfort, safety } = metrics;

  switch (routeType) {
    case 'cheapest':
      return cost * 0.7 + time * 0.2 + transfers * 0.1;
    case 'fastest':
      return time * 0.8 + cost * 0.1 + transfers * 0.1;
    case 'comfort':
      return comfort * 0.6 + time * 0.2 + cost * 0.2;
    case 'tourist':
      return safety * 0.5 + comfort * 0.3 + time * 0.2;
    default:
      return cost * 0.4 + time * 0.4 + transfers * 0.2;
  }
}
