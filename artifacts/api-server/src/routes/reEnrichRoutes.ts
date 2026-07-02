/**
 * Backwards-compatible wrapper for the old admin "re-enrich routes" action.
 *
 * The previous implementation wrote generated geometry directly into
 * transit_lines.route_path. This wrapper now delegates to the evidence-first
 * route repair engine:
 *   - protected GTFS/GPS/rail/locked routes are skipped,
 *   - old routePath is versioned before any accepted update,
 *   - candidates are saved first,
 *   - only high-confidence candidates are published when apply=true.
 */
import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import { db, transitLinesTable, transportTypesTable, type TransitLine, type TransportType } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import {
  generateRepairCandidate,
  saveRepairCandidate,
  type RepairCandidateResult,
  type StoredRepairResult,
} from "../utils/routeRepairEngine";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;

const router = Router();

function boolParam(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null || value === "") return defaultValue;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes"].includes(text)) return true;
  if (["false", "0", "no"].includes(text)) return false;
  return defaultValue;
}

function sourceFilter(value: unknown): Set<string> | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return new Set(value.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean));
}

function typeName(type: TransportType | undefined): string {
  return `${type?.nameEn ?? ""} ${type?.nameAr ?? ""}`.trim();
}

function label(line: TransitLine): string {
  return `${line.lineNumber ?? line.id} (${line.fromArea} -> ${line.toArea})`;
}

async function markNeedsReview(line: TransitLine, reason: string): Promise<void> {
  await db.update(transitLinesTable).set({
    routeStatus: "needs_review",
    needsReviewReason: reason,
    updatedAt: new Date(),
  }).where(eq(transitLinesTable.id, line.id));
}

function resultStatus(result: RepairCandidateResult | StoredRepairResult): string {
  if ("accepted" in result && result.accepted) return "updated";
  return result.reason ?? result.warnings[0] ?? result.status;
}

router.post("/", requireAdmin, async (req, res) => {
  const lineId = typeof req.query.lineId === "string" ? req.query.lineId.trim() : "";
  const transportMode = typeof req.query.transportMode === "string" ? req.query.transportMode.trim() : "";
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const dryRun = boolParam(req.query.dryRun, false);
  // Keep the old button useful: it may publish only if the new engine says the
  // candidate is high-confidence. Medium/low candidates remain saved for review.
  const apply = boolParam(req.query.apply, true);
  const requestedSources = sourceFilter(req.query.dataSource);

  const [types, allLines] = await Promise.all([
    db.select().from(transportTypesTable),
    db.select().from(transitLinesTable).orderBy(asc(transitLinesTable.id)),
  ]);
  const typeById = new Map(types.map((type) => [type.id, type]));

  let targets = allLines;
  if (lineId) targets = targets.filter((line) => line.id === lineId);
  if (transportMode) {
    const needle = transportMode.toLowerCase();
    targets = targets.filter((line) => typeName(typeById.get(line.transportTypeId)).toLowerCase().includes(needle));
  }
  if (requestedSources) {
    targets = targets.filter((line) => requestedSources.has((line.dataSource || "seed").toLowerCase()));
  } else {
    // Preserve the old endpoint's default promise: never touch rider GPS/discovery
    // by accident, even if an admin starts a broad batch.
    targets = targets.filter((line) => {
      const source = (line.dataSource || "seed").toLowerCase();
      return !source.includes("discovery") && !source.includes("gps");
    });
  }

  const totalMatching = targets.length;
  const batch = targets.slice(offset, offset + limit);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let candidatesSaved = 0;
  const results: Array<{
    id: string;
    line: string | null;
    label: string;
    status: string;
    coords?: number;
    confidenceLevel?: string;
    versionId?: string;
    warnings?: string[];
    route?: TransitLine;
  }> = [];

  for (const line of batch) {
    try {
      const generated = await generateRepairCandidate(line, typeById.get(line.transportTypeId), { repairMode: "auto" });
      let result: RepairCandidateResult | StoredRepairResult = generated;

      if (!dryRun && generated.geometry) {
        result = await saveRepairCandidate(line, generated, {
          apply,
          createdBy: req.userId,
          persistAnchors: true,
        });
        candidatesSaved++;
      } else if (!dryRun && (generated.status === "failed" || generated.status === "needs_review")) {
        await markNeedsReview(line, generated.reason ?? generated.warnings[0] ?? "route_repair_needs_review");
      }

      if ("accepted" in result && result.accepted) updated++;
      else if (generated.status === "failed") failed++;
      else skipped++;

      const [savedRoute] = "accepted" in result && result.accepted
        ? await db.select().from(transitLinesTable).where(eq(transitLinesTable.id, line.id)).limit(1)
        : [];
      results.push({
        id: line.id,
        line: line.lineNumber,
        label: label(line),
        status: resultStatus(result),
        coords: result.geometry?.coordinates.length,
        confidenceLevel: result.confidenceLevel,
        versionId: "versionId" in result ? result.versionId : undefined,
        warnings: result.warnings,
        route: savedRoute,
      });
    } catch (err) {
      await markNeedsReview(line, "route_repair_exception");
      failed++;
      results.push({
        id: line.id,
        line: line.lineNumber,
        label: label(line),
        status: err instanceof Error ? err.message : "route_repair_exception",
      });
    }
  }

  const nextOffset = offset + batch.length;
  res.json({
    dryRun,
    apply,
    lineId: lineId || null,
    transportMode: transportMode || "all-road-eligible",
    dataSourceFilter: requestedSources ? [...requestedSources] : "all-except-discovery-gps",
    totalMatching,
    offset,
    limit,
    processed: batch.length,
    updated,
    candidatesSaved,
    skipped,
    failed,
    nextOffset,
    done: nextOffset >= totalMatching,
    typeOf: batch.map((line) => typeById.get(line.transportTypeId)?.nameEn ?? "?")[0] ?? null,
    results,
  });
});

export default router;
