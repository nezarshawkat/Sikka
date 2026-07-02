import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  db,
  pool,
  routeGeometryVersionsTable,
  transitLinesTable,
  type TransitLine,
} from "@workspace/db";
import {
  saveRepairCandidate,
  type RepairCandidateResult,
} from "../utils/routeRepairEngine";

type CandidateRoute = Record<string, any> & {
  id: string;
  confidenceLevel: "high" | "medium" | "low";
  publishable: boolean;
};

async function main(): Promise<void> {
  const candidatePath = path.resolve(
    process.argv.find((argument) => argument.startsWith("--candidates="))?.slice(13) ??
      "scripts/generated/road-route-repair-candidates.json",
  );
  const validateOnly = process.argv.includes("--validate-only");
  const file = JSON.parse(await readFile(candidatePath, "utf8"));
  const routes = file.routes as CandidateRoute[];
  const high = routes.filter((route) => route.confidenceLevel === "high" && route.publishable).length;
  const medium = routes.filter((route) => route.confidenceLevel === "medium").length;
  if (routes.length !== 596 || routes.some((route) => route.confidenceLevel === "low")) {
    throw new Error(`Candidate validation failed: total=${routes.length}, low=${routes.filter((route) => route.confidenceLevel === "low").length}`);
  }
  console.log(`Validated ${routes.length} routes: ${high} independently high, ${medium} medium review candidates.`);
  if (validateOnly) return;

  const [lines, existingVersions] = await Promise.all([
    db.select().from(transitLinesTable),
    db.select({
      transitLineId: routeGeometryVersionsTable.transitLineId,
      evidence: routeGeometryVersionsTable.evidence,
    }).from(routeGeometryVersionsTable),
  ]);
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const alreadyImported = new Set(existingVersions
    .filter((version) => (version.evidence as any)?.offlineBatchRevision === file.sourceRevision)
    .map((version) => version.transitLineId));

  let saved = 0;
  let accepted = 0;
  let skipped = 0;
  for (const route of routes) {
    const line = lineById.get(route.id) as TransitLine | undefined;
    if (!line) throw new Error(`Transit line is missing from the database: ${route.id}`);
    if (alreadyImported.has(route.id)) {
      skipped += 1;
      continue;
    }
    const result: RepairCandidateResult = {
      status: "candidate",
      geometry: route.geometry,
      anchors: route.anchors ?? [],
      source: route.source,
      qualityScore: route.qualityScore,
      confidenceScore: route.confidenceScore,
      confidenceLevel: route.confidenceLevel,
      publishable: route.publishable,
      metrics: route.metrics,
      evidence: {
        ...(route.evidence ?? {}),
        offlineBatchRevision: file.sourceRevision,
        independentAuditAt: file.auditedAt,
      },
      warnings: route.warnings ?? [],
    };
    const stored = await saveRepairCandidate(line, result, {
      apply: route.confidenceLevel === "high" && route.publishable,
      createdBy: null,
      persistAnchors: false,
    });
    saved += 1;
    if (stored.accepted) accepted += 1;
    if ((saved + skipped) % 25 === 0) {
      console.log(`Processed ${saved + skipped}/${routes.length}; saved=${saved}, accepted=${accepted}, skipped=${skipped}`);
    }
  }
  console.log(JSON.stringify({ total: routes.length, saved, accepted, skipped, reviewCandidates: saved - accepted }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
