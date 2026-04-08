export function buildDemoGraph() {
  return {
    nodes: [
      { id: 'A', name: 'Start' },
      { id: 'B', name: 'Bus Stop 381' },
      { id: 'C', name: 'Metro Line 1' },
      { id: 'D', name: 'Destination' }
    ],
    edges: [
      { from: 'A', to: 'B', distance: 0.2, time: 4, cost: 0, comfort: 3, safety: 7, mode: 'walk', transfers: 0 },
      { from: 'B', to: 'C', distance: 5, time: 15, cost: 6, comfort: 5, safety: 6, mode: 'bus', transfers: 1 },
      { from: 'C', to: 'D', distance: 4, time: 12, cost: 5, comfort: 6, safety: 7, mode: 'metro', transfers: 1 },
      { from: 'A', to: 'C', distance: 6, time: 10, cost: 30, comfort: 8, safety: 8, mode: 'taxi', transfers: 0 },
      { from: 'C', to: 'D', distance: 4, time: 10, cost: 8, comfort: 7, safety: 7, mode: 'monorail', transfers: 1 }
    ]
  };
}
