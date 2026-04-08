export function dijkstra(graph, startId, endId) {
  const dist = new Map();
  const prev = new Map();
  const queue = new Set(graph.nodes.map((n) => n.id));

  for (const node of graph.nodes) dist.set(node.id, Infinity);
  dist.set(startId, 0);

  while (queue.size) {
    const current = [...queue].reduce((a, b) => (dist.get(a) < dist.get(b) ? a : b));
    queue.delete(current);
    if (current === endId) break;

    const neighbors = graph.edges.filter((e) => e.from === current);
    for (const edge of neighbors) {
      const alt = dist.get(current) + edge.time;
      if (alt < dist.get(edge.to)) {
        dist.set(edge.to, alt);
        prev.set(edge.to, { node: current, edge });
      }
    }
  }

  return reconstructPath(prev, startId, endId);
}

function reconstructPath(prev, startId, endId) {
  const path = [];
  let current = endId;

  while (current !== startId && prev.has(current)) {
    const item = prev.get(current);
    path.unshift(item.edge);
    current = item.node;
  }

  return path;
}
