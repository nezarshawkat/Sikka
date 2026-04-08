import { buildEgyptGraph } from '../models/egyptNetwork.js';
import { haversineKm } from '../utils/geo.js';
import { resolveWeights } from './weights.js';

const TRANSFER_PENALTY_MIN = 4;

function findNearestNode(graph, point) {
  return graph.nodes.reduce(
    (best, node) => {
      const distance = haversineKm(point, node);
      return distance < best.distance ? { node, distance } : best;
    },
    { node: graph.nodes[0], distance: Infinity }
  ).node;
}

function getEdgeScore(edge, weights) {
  const comfortPenalty = 10 - edge.comfort;
  const safetyPenalty = 10 - edge.safety;
  return (
    edge.costEgp * weights.cost +
    edge.timeMin * weights.time +
    TRANSFER_PENALTY_MIN * weights.transfers +
    comfortPenalty * weights.comfort +
    safetyPenalty * weights.safety
  );
}

function shortestByProfile(graph, startId, endId, weights) {
  const dist = new Map(graph.nodes.map((n) => [n.id, Infinity]));
  const prev = new Map();
  const unvisited = new Set(graph.nodes.map((n) => n.id));
  dist.set(startId, 0);

  while (unvisited.size) {
    const current = [...unvisited].reduce((a, b) => (dist.get(a) <= dist.get(b) ? a : b));
    unvisited.delete(current);
    if (current === endId) break;

    graph.edges
      .filter((edge) => edge.from === current)
      .forEach((edge) => {
        const score = getEdgeScore(edge, weights);
        const alt = dist.get(current) + score;
        if (alt < dist.get(edge.to)) {
          dist.set(edge.to, alt);
          prev.set(edge.to, { from: current, edge });
        }
      });
  }

  const edges = [];
  let nodeId = endId;
  while (nodeId !== startId && prev.has(nodeId)) {
    const step = prev.get(nodeId);
    edges.unshift(step.edge);
    nodeId = step.from;
  }
  return edges;
}

function summarize(edges) {
  return edges.reduce(
    (acc, edge, index) => {
      acc.timeMin += edge.timeMin;
      acc.costEgp += edge.costEgp;
      acc.distanceKm += edge.distanceKm;
      acc.avgComfort += edge.comfort;
      acc.avgSafety += edge.safety;
      if (index > 0 && edge.mode !== edges[index - 1].mode) acc.transfers += 1;
      acc.steps.push({
        instruction: `${edge.mode.replace('_', ' ')} via ${edge.line}`,
        mode: edge.mode,
        distanceKm: edge.distanceKm,
        timeMin: edge.timeMin,
        costEgp: edge.costEgp
      });
      return acc;
    },
    { timeMin: 0, costEgp: 0, distanceKm: 0, transfers: 0, avgComfort: 0, avgSafety: 0, steps: [] }
  );
}

function buildScenario(graph, startNode, endNode, profile) {
  const weights = resolveWeights(profile);
  const path = shortestByProfile(graph, startNode.id, endNode.id, weights);
  const metrics = summarize(path);
  const hops = Math.max(path.length, 1);
  metrics.avgComfort /= hops;
  metrics.avgSafety /= hops;
  return {
    profile,
    from: startNode.name,
    to: endNode.name,
    score: getEdgeScore(
      {
        costEgp: metrics.costEgp,
        timeMin: metrics.timeMin,
        comfort: metrics.avgComfort,
        safety: metrics.avgSafety
      },
      weights
    ) + metrics.transfers * TRANSFER_PENALTY_MIN,
    ...metrics
  };
}

export function findRouteScenarios(start, end, routeType = 'balanced') {
  const graph = buildEgyptGraph();
  const startNode = findNearestNode(graph, start);
  const endNode = findNearestNode(graph, end);
  const profiles = ['cheapest', 'fastest', 'balanced', 'comfort', 'tourist'];

  const unique = [...new Set([routeType, ...profiles])].slice(0, 5);
  return unique
    .map((profile) => buildScenario(graph, startNode, endNode, profile))
    .filter((r) => r.steps.length > 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5);
}
