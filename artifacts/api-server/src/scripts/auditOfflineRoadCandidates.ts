import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Point = [number, number];
type Candidate = Record<string, any> & {
  id: string;
  geometry?: { coordinates?: Point[] } | null;
  anchors?: Array<{ point?: Point; required?: boolean }>;
  metrics?: Record<string, any> | null;
  warnings: string[];
  confidenceLevel: "high" | "medium" | "low";
};

const candidatesPath = path.resolve(process.argv.find((arg) => arg.startsWith("--candidates="))?.slice(13) ??
  "scripts/generated/road-route-repair-candidates.json");
const snapshotPath = path.resolve(process.argv.find((arg) => arg.startsWith("--snapshot="))?.slice(11) ??
  "artifacts/sikka/src/data/bundledSnapshot.json");
const reportPath = path.resolve(process.argv.find((arg) => arg.startsWith("--report="))?.slice(9) ??
  "scripts/generated/road-route-repair-audit.json");
const valhallaUrl = (process.env.VALHALLA_URL || "http://localhost:8002").replace(/\/+$/, "");

function distanceKm(a: Point, b: Point): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const lat1 = rad(a[1]);
  const lat2 = rad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function sample<T>(values: T[], maximum: number): T[] {
  if (values.length <= maximum) return values;
  return Array.from({ length: maximum }, (_, index) =>
    values[Math.round((index * (values.length - 1)) / (maximum - 1))],
  );
}

function pathLength(points: Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index++) total += distanceKm(points[index - 1], points[index]);
  return total;
}

function maxStep(points: Point[]): number {
  let maximum = 0;
  for (let index = 1; index < points.length; index++) maximum = Math.max(maximum, distanceKm(points[index - 1], points[index]));
  return maximum;
}

function backtrack(points: Point[]): number {
  if (points.length < 3) return 0;
  const first = points[0];
  const last = points[points.length - 1];
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const span = dx * dx + dy * dy;
  if (span === 0) return 0;
  const projection = (point: Point) => ((point[0] - first[0]) * dx + (point[1] - first[1]) * dy) / span;
  let total = 0;
  let backwards = 0;
  let furthest = projection(first);
  for (let index = 1; index < points.length; index++) {
    const step = distanceKm(points[index - 1], points[index]);
    const current = projection(points[index]);
    total += step;
    if (current < furthest - 0.03) backwards += step;
    furthest = Math.max(furthest, current);
  }
  return total ? backwards / total : 0;
}

function nearest(point: Point, pathPoints: Point[]): { distance: number; index: number } {
  let best = Number.POSITIVE_INFINITY;
  let bestIndex = 0;
  for (let index = 0; index < pathPoints.length; index++) {
    const distance = distanceKm(point, pathPoints[index]);
    if (distance < best) {
      best = distance;
      bestIndex = index;
    }
  }
  return { distance: best, index: bestIndex };
}

async function roadCorrelation(points: Point[]): Promise<{ rate: number; maximumKm: number }> {
  const inspected = sample(points, 12);
  const response = await fetch(`${valhallaUrl}/locate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      locations: inspected.map((point) => ({ lon: point[0], lat: point[1] })),
      costing: "auto",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return { rate: 0, maximumKm: Number.POSITIVE_INFINITY };
  const located = await response.json() as Array<{
    input_lon: number;
    input_lat: number;
    edges?: Array<{ correlated_lon: number; correlated_lat: number }>;
  }>;
  const distances = located.map((item) => {
    const edge = item.edges?.[0];
    return edge ? distanceKm([item.input_lon, item.input_lat], [edge.correlated_lon, edge.correlated_lat]) : Infinity;
  });
  return {
    rate: distances.filter((distance) => distance <= 0.08).length / inspected.length,
    maximumKm: Math.max(...distances),
  };
}

async function main(): Promise<void> {
  const file = JSON.parse(await readFile(candidatesPath, "utf8"));
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  const originalById = new Map(snapshot.lines.map((line: any) => [line.id, line]));
  const results: any[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= file.routes.length) return;
      const route = file.routes[index] as Candidate;
      const original: any = originalById.get(route.id);
      const points = route.geometry?.coordinates ?? [];
      const failures: string[] = [];
      if (points.length < 2) failures.push("missing_geometry");
      const allInsideEgypt = points.every((point) => point[0] >= 24.5 && point[0] <= 37.8 && point[1] >= 21.3 && point[1] <= 32.2);
      if (!allInsideEgypt) failures.push("outside_egypt");

      const lengthKm = pathLength(points);
      const straightKm = points.length >= 2 ? distanceKm(points[0], points[points.length - 1]) : 0;
      const ratio = straightKm > 0.05 ? lengthKm / straightKm : 1;
      const maximumStepKm = maxStep(points);
      const backtrackRatio = backtrack(points);
      if (maximumStepKm > 0.56) failures.push("broken_or_sparse_segment");
      if (lengthKm > 250) failures.push("implausible_absolute_length");
      if (ratio > 4.2 && straightKm >= 0.3) failures.push("implausible_length_ratio");
      if (backtrackRatio > 0.28 && straightKm >= 0.3) failures.push("excessive_backtracking");

      const originalPath = Array.isArray(original?.path) ? original.path as Point[] : [];
      const startMissKm = originalPath.length && points.length ? distanceKm(originalPath[0], points[0]) : Infinity;
      const endMissKm = originalPath.length && points.length
        ? distanceKm(originalPath[originalPath.length - 1], points[points.length - 1])
        : Infinity;
      if (startMissKm > 0.35 || endMissKm > 0.35) failures.push("endpoint_miss");

      const requiredAnchors = (route.anchors ?? []).filter((anchor) => anchor.required && anchor.point);
      const projections = requiredAnchors.map((anchor) => nearest(anchor.point!, points));
      const anchorHitRate = projections.length
        ? projections.filter((item) => item.distance <= 0.18).length / projections.length
        : 0;
      let anchorOrder = true;
      let last = -1;
      for (const projection of projections) {
        if (projection.index + 4 < last) anchorOrder = false;
        last = Math.max(last, projection.index);
      }
      if (anchorHitRate < 0.85) failures.push("anchor_hit_rate");
      if (!anchorOrder && straightKm >= 0.3) failures.push("anchor_order");

      let correlation = { rate: 0, maximumKm: Infinity };
      try {
        correlation = await roadCorrelation(points);
      } catch {
        failures.push("valhalla_locate_failed");
      }
      if (correlation.rate < 0.95 || correlation.maximumKm > 0.1) failures.push("not_tightly_road_correlated");
      if (route.warnings.includes("endpoint_only_corridor_requires_review")) failures.push("endpoint_only_evidence");
      if (!String(route.source).startsWith("valhalla_")) failures.push("not_router_generated");

      const independentlyHigh = failures.length === 0;
      results[index] = {
        id: route.id,
        lineNumber: route.lineNumber,
        transportTypeName: route.transportTypeName,
        previousConfidence: route.confidenceLevel,
        independentlyHigh,
        failures,
        measurements: {
          points: points.length,
          lengthKm: Number(lengthKm.toFixed(3)),
          straightKm: Number(straightKm.toFixed(3)),
          lengthRatio: Number(ratio.toFixed(3)),
          maxStepKm: Number(maximumStepKm.toFixed(3)),
          backtrackRatio: Number(backtrackRatio.toFixed(3)),
          endpointStartMissKm: Number(startMissKm.toFixed(3)),
          endpointEndMissKm: Number(endMissKm.toFixed(3)),
          anchorHitRate: Number(anchorHitRate.toFixed(3)),
          anchorOrder,
          roadCorrelationRate: Number(correlation.rate.toFixed(3)),
          maxRoadCorrelationDistanceKm: Number(correlation.maximumKm.toFixed(3)),
        },
      };

      if (route.confidenceLevel === "high" && !independentlyHigh) {
        route.confidenceLevel = "medium";
        route.publishable = false;
        route.confidenceScore = Math.min(route.confidenceScore, 0.79);
        route.qualityScore = Math.min(route.qualityScore, 0.79);
        route.warnings = [...new Set([...route.warnings, "independent_audit_downgraded"] )];
        if (route.metrics) {
          route.metrics.confidenceLevel = "medium";
          route.metrics.publishable = false;
          route.metrics.warnings = [...new Set([...(route.metrics.warnings ?? []), "independent_audit_downgraded"] )];
        }
      }

      if ((index + 1) % 50 === 0) console.log(`Audited ${index + 1}/${file.routes.length}`);
    }
  }

  await Promise.all(Array.from({ length: 4 }, () => worker()));
  const high = file.routes.filter((route: Candidate) => route.confidenceLevel === "high").length;
  const medium = file.routes.filter((route: Candidate) => route.confidenceLevel === "medium").length;
  file.stats = { total: file.routes.length, candidate: file.routes.length, confidence_high: high, publishable: high, confidence_medium: medium };
  file.auditedAt = new Date().toISOString();
  file.auditReport = path.relative(path.dirname(candidatesPath), reportPath).replace(/\\/g, "/");

  await copyFile(candidatesPath, `${candidatesPath}.pre-audit.json`);
  await writeFile(candidatesPath, `${JSON.stringify(file)}\n`, "utf8");
  const report = {
    schemaVersion: 1,
    auditedAt: file.auditedAt,
    sourceRevision: file.sourceRevision,
    total: results.length,
    independentlyHigh: results.filter((result) => result.independentlyHigh).length,
    finalHigh: high,
    finalMedium: medium,
    downgraded: results.filter((result) => result.previousConfidence === "high" && !result.independentlyHigh).length,
    protectedRoutesIncluded: file.routes.filter((route: Candidate) => !originalById.has(route.id)).map((route: Candidate) => route.id),
    results,
  };
  await writeFile(reportPath, `${JSON.stringify(report)}\n`, "utf8");
  console.log(JSON.stringify({ finalHigh: high, finalMedium: medium, downgraded: report.downgraded }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
