export const egyptNodes = [
  { id: 'tahrir', name: 'Tahrir Square', lat: 30.0444, lng: 31.2357, city: 'Cairo', type: 'intersection' },
  { id: 'sadat', name: 'Sadat Metro', lat: 30.0448, lng: 31.2359, city: 'Cairo', type: 'metro' },
  { id: 'ramses', name: 'Ramses Station', lat: 30.0626, lng: 31.2462, city: 'Cairo', type: 'train' },
  { id: 'nasr_bus', name: 'Nasr City Bus Hub', lat: 30.0628, lng: 31.3302, city: 'Cairo', type: 'bus' },
  { id: 'giza', name: 'Giza Square', lat: 30.0131, lng: 31.2089, city: 'Giza', type: 'intersection' },
  { id: 'cairo_airport', name: 'Cairo Airport', lat: 30.1219, lng: 31.4056, city: 'Cairo', type: 'airport' },
  { id: 'alex_train', name: 'Alexandria Misr Station', lat: 31.2001, lng: 29.9187, city: 'Alexandria', type: 'train' },
  { id: 'alex_tram', name: 'Raml Tram Hub', lat: 31.2089, lng: 29.9092, city: 'Alexandria', type: 'tram' }
];

export const egyptEdges = [
  { from: 'tahrir', to: 'sadat', mode: 'walk', line: 'Walkway', distanceKm: 0.2, timeMin: 4, costEgp: 0, comfort: 5, safety: 8 },
  { from: 'sadat', to: 'ramses', mode: 'metro', line: 'Metro Line 1', distanceKm: 4.5, timeMin: 11, costEgp: 8, comfort: 7, safety: 8 },
  { from: 'ramses', to: 'nasr_bus', mode: 'bus', line: 'Public Bus 381', distanceKm: 8, timeMin: 26, costEgp: 10, comfort: 4, safety: 6 },
  { from: 'tahrir', to: 'giza', mode: 'microbus', line: 'Microbus GZ-7', distanceKm: 6.8, timeMin: 18, costEgp: 9, comfort: 3, safety: 5 },
  { from: 'giza', to: 'tahrir', mode: 'taxi', line: 'City Taxi', distanceKm: 6.8, timeMin: 13, costEgp: 75, comfort: 8, safety: 7 },
  { from: 'nasr_bus', to: 'cairo_airport', mode: 'monorail', line: 'East Cairo Monorail', distanceKm: 10, timeMin: 19, costEgp: 20, comfort: 8, safety: 8 },
  { from: 'ramses', to: 'alex_train', mode: 'train', line: 'Intercity Express', distanceKm: 210, timeMin: 145, costEgp: 90, comfort: 7, safety: 8 },
  { from: 'alex_train', to: 'alex_tram', mode: 'alex_tram', line: 'Alex Tram T1', distanceKm: 2.2, timeMin: 9, costEgp: 6, comfort: 5, safety: 7 },
  { from: 'tahrir', to: 'ramses', mode: 'ride_hailing', line: 'Careem/Uber', distanceKm: 6, timeMin: 15, costEgp: 120, comfort: 8, safety: 7 },
  { from: 'giza', to: 'ramses', mode: 'metro', line: 'Metro Line 2', distanceKm: 9.2, timeMin: 22, costEgp: 10, comfort: 7, safety: 8 },
  { from: 'alex_tram', to: 'alex_train', mode: 'walk', line: 'Walkway', distanceKm: 2.2, timeMin: 26, costEgp: 0, comfort: 5, safety: 8 }
];

export function buildEgyptGraph() {
  const bidirectionalModes = new Set(['walk', 'taxi', 'ride_hailing']);
  const edges = [...egyptEdges];
  egyptEdges.forEach((edge) => {
    if (bidirectionalModes.has(edge.mode)) {
      edges.push({ ...edge, from: edge.to, to: edge.from });
    }
  });

  return { nodes: egyptNodes, edges };
}
