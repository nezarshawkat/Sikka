import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  canRepairRoadRoute,
  checkRouteRepairRouter,
  generateRepairCandidate,
  type RepairAnchorInput,
} from "../utils/routeRepairEngine";

type SnapshotType = {
  id: string;
  nameEn?: string | null;
  nameAr?: string | null;
};

type SnapshotLine = Record<string, unknown> & {
  id: string;
  transportTypeId: string;
  lineNumber?: string | null;
  nameEn?: string | null;
  nameAr?: string | null;
  path?: [number, number][] | null;
  routeStatus?: string | null;
};

type Snapshot = {
  revision?: string;
  generatedAt?: string;
  types: SnapshotType[];
  lines: SnapshotLine[];
};

type OutputRoute = {
  id: string;
  transportTypeId: string;
  transportTypeName: string;
  lineNumber: string | null;
  nameEn: string | null;
  nameAr: string | null;
  originalPointCount: number;
  status: string;
  reason: string | null;
  source: string;
  qualityScore: number;
  confidenceScore: number;
  confidenceLevel: string;
  publishable: boolean;
  warnings: string[];
  anchors: unknown[];
  metrics: unknown;
  evidence: Record<string, unknown>;
  geometry: unknown;
};

type OutputFile = {
  schemaVersion: 1;
  generatedAt: string;
  sourceRevision: string | null;
  sourceGeneratedAt: string | null;
  router: unknown;
  selection: {
    totalSnapshotLines: number;
    eligibleRoadRoutes: number;
    protectedOrSkippedRoutes: number;
    offset: number;
    limit: number;
  };
  stats: Record<string, number>;
  routes: OutputRoute[];
};

function flag(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function distanceKm(a: [number, number], b: [number, number]): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(b[0] - a[0]);
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function simplifyRetryEvidence(routePath: [number, number][]): [number, number][] {
  const valid = routePath.filter((point) =>
    Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]),
  );
  if (valid.length < 3) return valid;

  const withoutSpikes: [number, number][] = [valid[0]];
  for (let index = 1; index < valid.length - 1; index++) {
    const previous = withoutSpikes[withoutSpikes.length - 1];
    const current = valid[index];
    const next = valid[index + 1];
    const intoSpike = distanceKm(previous, current);
    const outOfSpike = distanceKm(current, next);
    const bypass = distanceKm(previous, next);
    if (intoSpike > 4 && outOfSpike > 4 && bypass < Math.min(3, (intoSpike + outOfSpike) * 0.2)) continue;
    withoutSpikes.push(current);
  }
  withoutSpikes.push(valid[valid.length - 1]);

  let loopErased: [number, number][] = [];
  for (const point of withoutSpikes) {
    let reconnectAt = -1;
    for (let index = loopErased.length - 4; index >= 0; index--) {
      if (distanceKm(loopErased[index], point) <= 0.35) {
        reconnectAt = index;
        break;
      }
    }
    if (reconnectAt >= 0) loopErased = loopErased.slice(0, reconnectAt + 1);
    const previous = loopErased[loopErased.length - 1];
    if (!previous || distanceKm(previous, point) > 0.02) loopErased.push(point);
  }
  return loopErased.length >= 2 ? loopErased : withoutSpikes;
}

function retryAnchors(
  routePath: [number, number][],
  budget: number,
  monotonic: boolean,
): RepairAnchorInput[] {
  const valid = routePath.filter((point) =>
    Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]),
  );
  if (valid.length < 2) return [];
  let corridor = valid;
  if (monotonic) {
    const first = valid[0];
    const last = valid[valid.length - 1];
    const dx = last[0] - first[0];
    const dy = last[1] - first[1];
    const spanSquared = dx * dx + dy * dy;
    if (spanSquared > 0.0003) {
      let furthest = -0.05;
      corridor = valid.filter((point, index) => {
        if (index === 0 || index === valid.length - 1) return true;
        const projection = ((point[0] - first[0]) * dx + (point[1] - first[1]) * dy) / spanSquared;
        if (projection < furthest - 0.025 || projection < -0.05 || projection > 1.05) return false;
        furthest = Math.max(furthest, projection);
        return true;
      });
    }
  }

  const count = Math.min(Math.max(2, budget), corridor.length);
  const sampled = Array.from({ length: count }, (_, index) =>
    corridor[Math.round((index * (corridor.length - 1)) / (count - 1))],
  ).filter((point, index, array) => index === 0 || point[0] !== array[index - 1][0] || point[1] !== array[index - 1][1]);

  return sampled.map((point, index) => ({
    sequence: index,
    name: `Retry corridor anchor ${index + 1}`,
    lat: point[1],
    lng: point[0],
    source: "route_path_retry",
    required: true,
    confidenceScore: index === 0 || index === sampled.length - 1 ? 0.88 : 0.72,
    anchorType: index === 0 ? "start" : index === sampled.length - 1 ? "end" : "corridor",
  }));
}

async function generateWithRetries(
  line: any,
  transportType: any,
  routePath: [number, number][],
  targetHigh = false,
) {
  let best = await generateRepairCandidate(line, transportType, { repairMode: "auto" });
  if (best.confidenceLevel === "high" || (!targetHigh && best.confidenceLevel !== "low")) return best;

  const strategies = [
    { name: "loop_erased_16", anchors: retryAnchors(simplifyRetryEvidence(routePath), 16, true) },
    { name: "loop_erased_12", anchors: retryAnchors(simplifyRetryEvidence(routePath), 12, true) },
    { name: "monotonic_16", anchors: retryAnchors(routePath, 16, true) },
    { name: "monotonic_12", anchors: retryAnchors(routePath, 12, true) },
    { name: "monotonic_8", anchors: retryAnchors(routePath, 8, true) },
    { name: "sparse_8", anchors: retryAnchors(routePath, 8, false) },
    { name: "endpoints", anchors: retryAnchors(routePath, 2, false) },
  ];
  const rank = { low: 0, medium: 1, high: 2 } as const;

  for (const strategy of strategies) {
    if (strategy.anchors.length < 2) continue;
    let candidate = await generateRepairCandidate(line, transportType, {
      repairMode: "anchors",
      manualAnchors: strategy.anchors,
    });
    if (strategy.name === "endpoints" && candidate.confidenceLevel !== "low") {
      const warning = "endpoint_only_corridor_requires_review";
      candidate = {
        ...candidate,
        status: "candidate",
        confidenceLevel: "medium",
        confidenceScore: Math.min(candidate.confidenceScore, 0.72),
        publishable: false,
        warnings: [...new Set([...candidate.warnings, warning])],
        metrics: candidate.metrics ? {
          ...candidate.metrics,
          confidenceLevel: "medium",
          publishable: false,
          warnings: [...new Set([...candidate.metrics.warnings, warning])],
        } : null,
      };
    }
    const evidenceEnough = true;
    if (evidenceEnough && (
      rank[candidate.confidenceLevel] > rank[best.confidenceLevel] ||
      (rank[candidate.confidenceLevel] === rank[best.confidenceLevel] && candidate.qualityScore > best.qualityScore)
    )) {
      best = {
        ...candidate,
        evidence: { ...candidate.evidence, retryStrategy: strategy.name },
      };
    }
    if (best.confidenceLevel === "high" || (!targetHigh && best.confidenceLevel !== "low")) break;
  }
  return best;
}

function toTransitLine(line: SnapshotLine): any {
  const { path: routeCoordinates, ...rest } = line;
  return {
    ...rest,
    isActive: line.routeStatus !== "inactive",
    routePath: Array.isArray(routeCoordinates) && routeCoordinates.length >= 2
      ? { type: "LineString", coordinates: routeCoordinates }
      : null,
  };
}

function stats(routes: OutputRoute[]): Record<string, number> {
  const result: Record<string, number> = { total: routes.length };
  for (const route of routes) {
    result[route.status] = (result[route.status] ?? 0) + 1;
    result[`confidence_${route.confidenceLevel}`] = (result[`confidence_${route.confidenceLevel}`] ?? 0) + 1;
    if (route.publishable) result.publishable = (result.publishable ?? 0) + 1;
  }
  return result;
}

async function atomicWrite(filePath: string, value: OutputFile): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, "utf8");
  await rm(filePath, { force: true });
  await rename(temporary, filePath);
}

async function loadExisting(filePath: string, revision: string | null): Promise<OutputRoute[]> {
  try {
    const existing = JSON.parse(await readFile(filePath, "utf8")) as OutputFile;
    return existing.sourceRevision === revision && Array.isArray(existing.routes) ? existing.routes : [];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(process.cwd());
  const input = path.resolve(flag(
    "input",
    path.join(projectRoot, "artifacts/sikka/src/data/bundledSnapshot.json"),
  )!);
  const output = path.resolve(flag(
    "output",
    path.join(projectRoot, "scripts/generated/road-route-repair-candidates.json"),
  )!);
  const offset = positiveInteger(flag("offset"), 0);
  const limit = positiveInteger(flag("limit"), Number.MAX_SAFE_INTEGER);
  const concurrency = Math.max(1, Math.min(4, positiveInteger(flag("concurrency"), 2)));
  const retryLow = process.argv.includes("--retry-low");
  const retryMedium = process.argv.includes("--retry-medium");

  const snapshot = JSON.parse(await readFile(input, "utf8")) as Snapshot;
  const typeById = new Map(snapshot.types.map((type) => [type.id, type]));
  const classified = snapshot.lines.map((snapshotLine) => {
    const line = toTransitLine(snapshotLine);
    const transportType = typeById.get(snapshotLine.transportTypeId) ?? null;
    return { snapshotLine, line, transportType, guard: canRepairRoadRoute(line, transportType as any) };
  });
  const eligible = classified.filter((item) => item.guard.ok);
  const selected = eligible.slice(offset, Math.min(eligible.length, offset + limit));
  const sourceRevision = snapshot.revision ?? null;
  const router = await checkRouteRepairRouter();
  if (!router.reachable) throw new Error(`Valhalla is unavailable: ${router.error ?? router.url}`);

  const prior = await loadExisting(output, sourceRevision);
  const resultsById = new Map(prior.map((route) => [route.id, route]));
  let completedThisRun = 0;

  const createOutput = (): OutputFile => {
    const routes = [...resultsById.values()].sort((a, b) => a.id.localeCompare(b.id));
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sourceRevision,
      sourceGeneratedAt: snapshot.generatedAt ?? null,
      router,
      selection: {
        totalSnapshotLines: snapshot.lines.length,
        eligibleRoadRoutes: eligible.length,
        protectedOrSkippedRoutes: snapshot.lines.length - eligible.length,
        offset,
        limit: Math.min(limit, selected.length),
      },
      stats: stats(routes),
      routes,
    };
  };

  const pending = selected.filter((item) => {
    const existing = resultsById.get(item.snapshotLine.id);
    return !existing ||
      (retryLow && existing.confidenceLevel === "low") ||
      (retryMedium && existing.confidenceLevel === "medium");
  });
  console.log(`Snapshot ${sourceRevision ?? "unknown"}: ${eligible.length} eligible, ${pending.length} pending.`);
  console.log(`Valhalla: ${router.valhallaUrl}`);

  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= pending.length) return;
      const item = pending[index];
      const typeName = item.transportType?.nameEn ?? item.transportType?.nameAr ?? item.snapshotLine.transportTypeId;
      try {
        const candidate = await generateWithRetries(
          item.line,
          item.transportType as any,
          item.snapshotLine.path ?? [],
          retryMedium,
        );
        resultsById.set(item.snapshotLine.id, {
          id: item.snapshotLine.id,
          transportTypeId: item.snapshotLine.transportTypeId,
          transportTypeName: typeName,
          lineNumber: item.snapshotLine.lineNumber ?? null,
          nameEn: item.snapshotLine.nameEn ?? null,
          nameAr: item.snapshotLine.nameAr ?? null,
          originalPointCount: item.snapshotLine.path?.length ?? 0,
          status: candidate.status,
          reason: candidate.reason ?? null,
          source: candidate.source,
          qualityScore: candidate.qualityScore,
          confidenceScore: candidate.confidenceScore,
          confidenceLevel: candidate.confidenceLevel,
          publishable: candidate.publishable,
          warnings: candidate.warnings,
          anchors: candidate.anchors,
          metrics: candidate.metrics,
          evidence: candidate.evidence,
          geometry: candidate.geometry,
        });
      } catch (error) {
        resultsById.set(item.snapshotLine.id, {
          id: item.snapshotLine.id,
          transportTypeId: item.snapshotLine.transportTypeId,
          transportTypeName: typeName,
          lineNumber: item.snapshotLine.lineNumber ?? null,
          nameEn: item.snapshotLine.nameEn ?? null,
          nameAr: item.snapshotLine.nameAr ?? null,
          originalPointCount: item.snapshotLine.path?.length ?? 0,
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
          source: "exception",
          qualityScore: 0,
          confidenceScore: 0,
          confidenceLevel: "low",
          publishable: false,
          warnings: ["candidate_generation_exception"],
          anchors: [],
          metrics: null,
          evidence: {},
          geometry: null,
        });
      }

      completedThisRun += 1;
      if (completedThisRun % 10 === 0 || completedThisRun === pending.length) {
        await atomicWrite(output, createOutput());
        console.log(`Completed ${completedThisRun}/${pending.length}; total saved ${resultsById.size}/${eligible.length}.`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await atomicWrite(output, createOutput());
  console.log(`Finished. Candidate file: ${output}`);
  console.log(JSON.stringify(stats([...resultsById.values()]), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
