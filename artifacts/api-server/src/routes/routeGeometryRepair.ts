import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import {
  db,
  routeGeometryVersionsTable,
  transitLinesTable,
  transportTypesTable,
  type TransitLine,
  type TransportType,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import {
  acceptGeometryVersion,
  auditGeometry,
  checkRouteRepairRouter,
  generateRepairCandidate,
  listGeometryVersions,
  rejectGeometryVersion,
  saveRepairCandidate,
  type RepairAnchorInput,
  type RepairCandidateResult,
  type StoredRepairResult,
} from "../utils/routeRepairEngine";

const router = Router();

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;

function boolValue(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(text)) return true;
  if (["false", "0", "no", "n"].includes(text)) return false;
  return defaultValue;
}

function numberValue(value: unknown, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function repairModeValue(value: unknown): "existing_path" | "anchors" | "auto" {
  const text = stringValue(value);
  return text === "existing_path" || text === "anchors" || text === "auto" ? text : "auto";
}

function sourceSet(value: unknown): Set<string> | null {
  const raw = stringValue(value);
  if (!raw) return null;
  const values = raw.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
  return values.length ? new Set(values) : null;
}

async function loadTypesAndLines(): Promise<{ types: TransportType[]; lines: TransitLine[]; typeById: Map<string, TransportType> }> {
  const [types, lines] = await Promise.all([
    db.select().from(transportTypesTable).orderBy(asc(transportTypesTable.nameEn)),
    db.select().from(transitLinesTable).orderBy(asc(transitLinesTable.id)),
  ]);
  return { types, lines, typeById: new Map(types.map((type) => [type.id, type])) };
}

function filterLines(
  lines: TransitLine[],
  typeById: Map<string, TransportType>,
  filters: { lineId: string; transportMode: string; dataSource: Set<string> | null },
): TransitLine[] {
  let targets = lines;
  if (filters.lineId) targets = targets.filter((line) => line.id === filters.lineId);
  if (filters.transportMode) {
    const needle = filters.transportMode.toLowerCase();
    targets = targets.filter((line) => {
      const type = typeById.get(line.transportTypeId);
      return `${type?.nameEn ?? ""} ${type?.nameAr ?? ""}`.toLowerCase().includes(needle);
    });
  }
  if (filters.dataSource) {
    targets = targets.filter((line) => filters.dataSource!.has((line.dataSource || "seed").toLowerCase()));
  }
  return targets;
}

function routeLabel(line: TransitLine): string {
  return `${line.lineNumber ?? line.id} (${line.fromArea} -> ${line.toArea})`;
}

function summariseResult(
  line: TransitLine,
  result: RepairCandidateResult | StoredRepairResult,
): {
  id: string;
  line: string | null;
  label: string;
  status: string;
  reason?: string;
  coords?: number;
  confidenceLevel?: string;
  qualityScore?: number;
  accepted?: boolean;
  versionId?: string;
  version?: number;
  warnings?: string[];
} {
  return {
    id: line.id,
    line: line.lineNumber,
    label: routeLabel(line),
    status: result.status,
    reason: result.reason,
    coords: result.geometry?.coordinates.length,
    confidenceLevel: result.confidenceLevel,
    qualityScore: Number(result.qualityScore.toFixed(3)),
    accepted: "accepted" in result ? result.accepted : false,
    versionId: "versionId" in result ? result.versionId : undefined,
    version: "version" in result ? result.version : undefined,
    warnings: result.warnings,
  };
}

async function markNeedsReview(line: TransitLine, reason: string): Promise<void> {
  await db.update(transitLinesTable).set({
    routeStatus: "needs_review",
    needsReviewReason: reason,
    updatedAt: new Date(),
  }).where(eq(transitLinesTable.id, line.id));
}

router.post("/geometry-audit", requireAdmin, async (_req, res) => {
  const routerStatus = await checkRouteRepairRouter();
  const { lines, typeById } = await loadTypesAndLines();
  const versions = await db.select({
    status: routeGeometryVersionsTable.status,
  }).from(routeGeometryVersionsTable);

  const candidateStatuses = versions.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  const examples: Array<{
    id: string;
    line: string | null;
    transportType: string;
    issue: string;
    pointCount: number;
    maxStepKm: number | null;
  }> = [];

  let protectedGtfs = 0;
  let protectedDiscovery = 0;
  let lockedRoutes = 0;
  let fixedRailRoutes = 0;
  let inactiveRoutes = 0;
  let eligibleRoadRoutes = 0;
  let routesMissingGeometry = 0;
  let routesWithSuspectGeometry = 0;
  let routesWithHighMaxStep = 0;

  for (const line of lines) {
    const type = typeById.get(line.transportTypeId);
    const audit = auditGeometry(line, type);
    const source = (line.dataSource || "").toLowerCase();
    const typeName = `${type?.nameEn ?? ""} ${type?.nameAr ?? ""}`.toLowerCase();
    if (source === "gtfs") protectedGtfs++;
    if (source.includes("discovery") || source.includes("gps")) protectedDiscovery++;
    if (line.geometryLocked) lockedRoutes++;
    if (["metro", "monorail", "lrt", "tram", "train", "rail"].some((term) => typeName.includes(term))) fixedRailRoutes++;
    if (!line.isActive || line.routeStatus === "inactive") inactiveRoutes++;
    if (audit.guard.ok) eligibleRoadRoutes++;
    if (!audit.hasGeometry) routesMissingGeometry++;
    if (audit.warnings.length) routesWithSuspectGeometry++;
    if ((audit.maxStepKm ?? 0) > 0.75) routesWithHighMaxStep++;

    if (examples.length < 25 && (!audit.hasGeometry || audit.warnings.length || !audit.guard.ok)) {
      examples.push({
        id: line.id,
        line: line.lineNumber,
        transportType: type?.nameEn ?? "Unknown",
        issue: audit.guard.ok ? audit.warnings[0] ?? "suspect_geometry" : audit.guard.reason ?? "protected",
        pointCount: audit.pointCount,
        maxStepKm: audit.maxStepKm,
      });
    }
  }

  res.json({
    routerStatus,
    totalRoutes: lines.length,
    protectedGtfs,
    protectedDiscovery,
    lockedRoutes,
    fixedRailRoutes,
    inactiveRoutes,
    eligibleRoadRoutes,
    routesMissingGeometry,
    routesWithSuspectGeometry,
    routesWithHighMaxStep,
    candidatesByStatus: candidateStatuses,
    examples,
  });
});

router.post("/generate-candidates", requireAdmin, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const dryRun = boolValue(req.query.dryRun ?? body.dryRun, true);
  const apply = boolValue(req.query.apply ?? body.apply, false);
  const limit = Math.min(MAX_LIMIT, Math.max(1, numberValue(req.query.limit ?? body.limit, DEFAULT_LIMIT)));
  const offset = Math.max(0, numberValue(req.query.offset ?? body.offset, 0));
  const lineId = stringValue(req.query.lineId ?? body.lineId);
  const transportMode = stringValue(req.query.transportMode ?? body.transportMode);
  const dataSource = sourceSet(req.query.dataSource ?? body.dataSource);
  const repairMode = repairModeValue(req.query.repairMode ?? body.repairMode);

  const { lines, typeById } = await loadTypesAndLines();
  const matching = filterLines(lines, typeById, { lineId, transportMode, dataSource });
  const batch = matching.slice(offset, offset + limit);

  const results: ReturnType<typeof summariseResult>[] = [];
  let updated = 0;
  let candidatesSaved = 0;
  let skipped = 0;
  let failed = 0;
  let needsReview = 0;

  for (const line of batch) {
    const generated = await generateRepairCandidate(line, typeById.get(line.transportTypeId), { repairMode });
    if (generated.status === "skipped") skipped++;
    if (generated.status === "failed") failed++;
    if (generated.status === "needs_review") needsReview++;

    let result: RepairCandidateResult | StoredRepairResult = generated;
    if (!dryRun && generated.geometry) {
      result = await saveRepairCandidate(line, generated, {
        apply,
        createdBy: req.userId,
        persistAnchors: true,
      });
      candidatesSaved++;
      if ("accepted" in result && result.accepted) updated++;
    } else if (!dryRun && (generated.status === "failed" || generated.status === "needs_review")) {
      await markNeedsReview(line, generated.reason ?? generated.warnings[0] ?? "route_repair_needs_review");
    }

    results.push(summariseResult(line, result));
  }

  const nextOffset = offset + batch.length;
  res.json({
    dryRun,
    apply,
    repairMode,
    lineId: lineId || null,
    transportMode: transportMode || null,
    dataSourceFilter: dataSource ? [...dataSource] : null,
    totalMatching: matching.length,
    offset,
    limit,
    processed: batch.length,
    updated,
    candidatesSaved,
    skipped,
    failed,
    needsReview,
    nextOffset,
    done: nextOffset >= matching.length,
    results,
  });
});

router.post("/:id/repair/regenerate-through-anchors", requireAdmin, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const dryRun = boolValue(body.dryRun, false);
  const apply = boolValue(body.apply, false);
  const anchors = Array.isArray(body.anchors) ? body.anchors as RepairAnchorInput[] : [];
  if (anchors.length < 2) {
    res.status(400).json({ error: "At least two coordinate anchors are required" });
    return;
  }

  const routeId = String(req.params.id);
  const [line] = await db.select().from(transitLinesTable).where(eq(transitLinesTable.id, routeId)).limit(1);
  if (!line) {
    res.status(404).json({ error: "route not found" });
    return;
  }
  const [type] = await db.select().from(transportTypesTable).where(eq(transportTypesTable.id, line.transportTypeId)).limit(1);

  const generated = await generateRepairCandidate(line, type, {
    repairMode: "anchors",
    manualAnchors: anchors,
  });

  let result: RepairCandidateResult | StoredRepairResult = generated;
  if (!dryRun && generated.geometry) {
    result = await saveRepairCandidate(line, generated, {
      apply,
      createdBy: req.userId,
      persistAnchors: true,
    });
  } else if (!dryRun && (generated.status === "failed" || generated.status === "needs_review")) {
    await markNeedsReview(line, generated.reason ?? generated.warnings[0] ?? "anchor_regeneration_needs_review");
  }

  res.json({
    dryRun,
    apply,
    selectedSectionStartAnchorId: body.selectedSectionStartAnchorId ?? null,
    selectedSectionEndAnchorId: body.selectedSectionEndAnchorId ?? null,
    result: summariseResult(line, result),
    geometry: result.geometry,
    metrics: result.metrics,
    evidence: result.evidence,
  });
});

router.get("/:id/geometry-candidates", requireAdmin, async (req, res) => {
  const routeId = String(req.params.id);
  const [line] = await db.select().from(transitLinesTable).where(eq(transitLinesTable.id, routeId)).limit(1);
  if (!line) {
    res.status(404).json({ error: "route not found" });
    return;
  }
  const versions = await listGeometryVersions(line.id);
  res.json({
    activePath: line.routePath,
    activeGeometryVersionId: line.activeGeometryVersionId,
    versions,
  });
});

router.post("/:id/geometry/:versionId/accept", requireAdmin, async (req, res) => {
  try {
    const accepted = await acceptGeometryVersion(String(req.params.id), String(req.params.versionId));
    res.json({ accepted });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "failed to accept geometry" });
  }
});

router.post("/:id/geometry/:versionId/reject", requireAdmin, async (req, res) => {
  try {
    const rejected = await rejectGeometryVersion(String(req.params.id), String(req.params.versionId));
    res.json({ rejected });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "failed to reject geometry" });
  }
});

export default router;
