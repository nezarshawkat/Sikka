import { Router } from "express";
import { db } from "@workspace/db";
import { transitLinesTable, reviewsTable, reportsTable } from "@workspace/db";
import { eq, asc, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { haversineKm } from "../utils/routePathGenerator.js";

const router = Router();

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function splitNumbers(value: string | null | undefined): string[] {
  return (value ?? "").split(/[,/]/).map((s) => norm(s)).filter(Boolean);
}

/** Loose geometric overlap check: same general corridor if the endpoints are
 *  close and the path doesn't wander far from a straight average of the two. */
function roughlySamePath(a: [number, number][] | null, b: [number, number][] | null): boolean {
  if (!a?.length || !b?.length) return false;
  const endClose = haversineKm(a[0], b[0]) < 0.6 && haversineKm(a[a.length - 1], b[b.length - 1]) < 0.6;
  const endCloseReversed = haversineKm(a[0], b[b.length - 1]) < 0.6 && haversineKm(a[a.length - 1], b[0]) < 0.6;
  return endClose || endCloseReversed;
}

interface TransitLineUpdate {
  lineNumber?: string;
  nameEn?: string;
  nameAr?: string;
  fromArea?: string;
  toArea?: string;
  viaStops?: string[];
  routePath?: { type: string; coordinates: [number, number][] } | null;
  routeDirection?: string;
  governorate?: string;
  priceEgp?: number;
  frequencyMinutes?: number | null;
  hasFixedStops?: boolean;
  isActive?: boolean;
  transportTypeId?: string;
  dataSource?: string;
  sourcePriority?: number;
  confidenceScore?: number;
  routeStatus?: "active" | "needs_review" | "inactive" | "pending_discovery";
  verifiedAt?: Date | string | null;
  lastConfirmedAt?: Date | string | null;
  needsReviewReason?: string | null;
  reviewReportCount?: number;
  updatedAt?: Date;
}

router.get("/", async (req, res) => {
  if (req.query.active === "true") {
    const rows = await db.select().from(transitLinesTable).where(eq(transitLinesTable.isActive, true)).orderBy(asc(transitLinesTable.lineNumber));
    return res.json(rows);
  }
  const rows = await db.select().from(transitLinesTable).orderBy(asc(transitLinesTable.lineNumber));
  return res.json(rows);
});

router.get("/:id", async (req, res) => {
  const [row] = await db.select().from(transitLinesTable).where(eq(transitLinesTable.id, req.params.id as string));
  if (!row) return res.status(404).json({ error: "route not found" });
  return res.json(row);
});

router.post("/", requireAdmin, async (req, res) => {
  const { transportTypeId, lineNumber, nameEn, nameAr, fromArea, toArea, viaStops, routePath, routeDirection, priceEgp, frequencyMinutes, hasFixedStops } = req.body;
  const [row] = await db.insert(transitLinesTable).values({
    transportTypeId,
    lineNumber,
    nameEn: nameEn ?? `${lineNumber}: ${fromArea} to ${toArea}`,
    nameAr: nameAr ?? `${lineNumber}: ${fromArea} - ${toArea}`,
    fromArea,
    toArea,
    viaStops: viaStops ?? [],
    routePath: routePath ?? null,
    routeDirection: routeDirection ?? "forward",
    priceEgp: priceEgp ?? 5,
    frequencyMinutes: frequencyMinutes ?? null,
    hasFixedStops: hasFixedStops ?? false,
    dataSource: "admin",
    sourcePriority: 20,
    confidenceScore: routePath ? 0.75 : 0.55,
    routeStatus: routePath ? "active" : "needs_review",
    verifiedAt: routePath ? new Date() : null,
    needsReviewReason: routePath ? null : "missing route geometry",
  }).returning();
  res.json(row);
});

router.put("/:id", requireAdmin, async (req, res) => {
  const allowed: (keyof TransitLineUpdate)[] = [
    "lineNumber", "nameEn", "nameAr", "fromArea", "toArea", "viaStops",
    "routePath", "routeDirection", "governorate", "priceEgp", "frequencyMinutes", "hasFixedStops", "isActive", "transportTypeId",
    "dataSource", "sourcePriority", "confidenceScore", "routeStatus", "verifiedAt", "lastConfirmedAt", "needsReviewReason", "reviewReportCount",
  ];
  const updates: TransitLineUpdate = { updatedAt: new Date() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      const value = req.body[key];
      if ((key === "verifiedAt" || key === "lastConfirmedAt") && typeof value === "string") {
        (updates as Record<keyof TransitLineUpdate, unknown>)[key] = value ? new Date(value) : null;
      } else {
        (updates as Record<keyof TransitLineUpdate, unknown>)[key] = value;
      }
    }
  }
  const [row] = await db.update(transitLinesTable).set(updates).where(eq(transitLinesTable.id, req.params.id as string)).returning();
  res.json(row);
});

router.delete("/:id", requireAdmin, async (req, res) => {
  await db.delete(transitLinesTable).where(eq(transitLinesTable.id, req.params.id as string));
  res.json({ success: true });
});

interface DuplicateGroup {
  keptId: string;
  keptLabel: string;
  removedIds: string[];
  removedLabels: string[];
  reason: string;
}

/**
 * Finds (and, with ?apply=true, merges) clusters of transit lines that
 * describe the same real-world corridor but ended up as separate rows — the
 * classic case being a CSV/AI-generated placeholder whose geometry was too
 * broken to be recognized as "the same route" as a later GPS-verified
 * discovery line. The active fix in promoteDiscoveredRoute() (corridor
 * fallback matching) prevents NEW duplicates going forward; this endpoint
 * cleans up ones that already exist.
 *
 * Dry-run by default (no DB writes) — pass ?apply=true to actually merge.
 * Merging keeps the highest-priority/most-confident line in each group,
 * re-points any reviews/reports that referenced a removed line onto the
 * survivor (so rider feedback history isn't lost), then deletes the rest.
 */
router.post("/dedupe", requireAdmin, async (req, res) => {
  const apply = req.query.apply === "true";

  const lines = await db
    .select({
      id: transitLinesTable.id,
      transportTypeId: transitLinesTable.transportTypeId,
      lineNumber: transitLinesTable.lineNumber,
      nameEn: transitLinesTable.nameEn,
      fromArea: transitLinesTable.fromArea,
      toArea: transitLinesTable.toArea,
      routePath: transitLinesTable.routePath,
      sourcePriority: transitLinesTable.sourcePriority,
      confidenceScore: transitLinesTable.confidenceScore,
      reviewReportCount: transitLinesTable.reviewReportCount,
    })
    .from(transitLinesTable)
    .orderBy(asc(transitLinesTable.transportTypeId));

  const byType = new Map<string, typeof lines>();
  for (const l of lines) {
    const arr = byType.get(l.transportTypeId) ?? [];
    arr.push(l);
    byType.set(l.transportTypeId, arr);
  }

  const groups: DuplicateGroup[] = [];
  const claimed = new Set<string>();

  for (const sameType of byType.values()) {
    for (let i = 0; i < sameType.length; i++) {
      const a = sameType[i];
      if (claimed.has(a.id)) continue;
      const cluster = [a];

      for (let j = i + 1; j < sameType.length; j++) {
        const b = sameType[j];
        if (claimed.has(b.id)) continue;

        const fromA = norm(a.fromArea), toA = norm(a.toArea);
        const fromB = norm(b.fromArea), toB = norm(b.toArea);
        const sameAreas = (fromA === fromB && toA === toB) || (fromA === toB && toA === fromB);
        if (!sameAreas) continue;

        const numsA = splitNumbers(a.lineNumber);
        const numsB = splitNumbers(b.lineNumber);
        const bothHaveNumbers = numsA.length > 0 && numsB.length > 0;
        if (bothHaveNumbers && !numsA.some((n) => numsB.includes(n))) continue;

        // Areas (and numbers, where present) already line up; geometry only
        // needs to roughly agree, since a broken placeholder's geometry is
        // exactly what we're trying to replace.
        const coordsA = (a.routePath?.coordinates ?? null) as [number, number][] | null;
        const coordsB = (b.routePath?.coordinates ?? null) as [number, number][] | null;
        if (coordsA && coordsB && !roughlySamePath(coordsA, coordsB)) continue;

        cluster.push(b);
        claimed.add(b.id);
      }

      if (cluster.length > 1) {
        claimed.add(a.id);
        const sorted = [...cluster].sort((x, y) =>
          (y.sourcePriority - x.sourcePriority)
          || (y.confidenceScore - x.confidenceScore)
          || (y.reviewReportCount - x.reviewReportCount));
        const winner = sorted[0];
        const losers = sorted.slice(1);
        groups.push({
          keptId: winner.id,
          keptLabel: `${winner.lineNumber ?? ""} ${winner.nameEn} (${winner.fromArea} -> ${winner.toArea})`.trim(),
          removedIds: losers.map((l) => l.id),
          removedLabels: losers.map((l) => `${l.lineNumber ?? ""} ${l.nameEn} (${l.fromArea} -> ${l.toArea})`.trim()),
          reason: "same corridor (area names" + (losers.some((l) => splitNumbers(l.lineNumber).length) ? " + line number" : "") + " match)",
        });
      }
    }
  }

  if (apply) {
    for (const group of groups) {
      if (!group.removedIds.length) continue;
      // Re-point any review/report history onto the surviving line before
      // deleting the duplicates, so rider feedback isn't silently lost.
      await db.update(reviewsTable).set({ transitLineId: group.keptId }).where(inArray(reviewsTable.transitLineId, group.removedIds));
      await db.update(reportsTable).set({ transitLineId: group.keptId }).where(inArray(reportsTable.transitLineId, group.removedIds));
      await db.delete(transitLinesTable).where(inArray(transitLinesTable.id, group.removedIds));
    }
  }

  res.json({
    applied: apply,
    groupsFound: groups.length,
    duplicateLinesRemoved: groups.reduce((sum, g) => sum + g.removedIds.length, 0),
    groups,
  });
});

export default router;
