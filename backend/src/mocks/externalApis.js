export async function getTrafficSnapshot(lat, lng) {
  return {
    lat,
    lng,
    congestionLevel: 'medium',
    incidents: [],
    source: 'mock'
  };
}

export async function estimateTaxiPrice(startLat, startLng, endLat, endLng) {
  return {
    currency: 'EGP',
    estimatedLow: 95,
    estimatedHigh: 140,
    providers: ['Uber (mock)', 'Careem (mock)'],
    input: { startLat, startLng, endLat, endLng }
  };
}
