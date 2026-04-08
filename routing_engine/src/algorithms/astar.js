function heuristic() {
  return 0;
}

export function astar(graph, startId, endId) {
  const open = new Set([startId]);
  const cameFrom = new Map();
  const gScore = new Map(graph.nodes.map((n) => [n.id, Infinity]));
  const fScore = new Map(graph.nodes.map((n) => [n.id, Infinity]));

  gScore.set(startId, 0);
  fScore.set(startId, heuristic());

  while (open.size > 0) {
    const current = [...open].reduce((a, b) => (fScore.get(a) < fScore.get(b) ? a : b));
    if (current === endId) return rebuild(cameFrom, current);
    open.delete(current);

    for (const edge of graph.edges.filter((e) => e.from === current)) {
      const tentative = gScore.get(current) + edge.time;
      if (tentative < gScore.get(edge.to)) {
        cameFrom.set(edge.to, { node: current, edge });
        gScore.set(edge.to, tentative);
        fScore.set(edge.to, tentative + heuristic());
        open.add(edge.to);
      }
    }
  }

  return [];
}

function rebuild(cameFrom, current) {
  const path = [];
  while (cameFrom.has(current)) {
    const item = cameFrom.get(current);
    path.unshift(item.edge);
    current = item.node;
  }
  return path;
}
