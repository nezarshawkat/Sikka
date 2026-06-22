import { Router } from "express";
import { db } from "@workspace/db";
import { reportsTable, transitLinesTable, profilesTable } from "@workspace/db";
import { eq, desc, and, sql, type SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Public, read-only service-alert lookup for a single transit line — surfaced
 * as a live banner during planning/active trips. Deliberately returns only a
 * count and the most common report type, never the underlying report rows
 * (description, user, exact location), so this can be safe to call without
 * admin auth from any rider's device.
 */
router.get("/active-alerts/:transitLineId", async (req, res) => {
  const { transitLineId } = req.params;
  if (!UUID_RE.test(transitLineId)) return res.json({ count: 0, reportType: null });

  const sinceHours = 6;
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const rows = await db
    .select({ reportType: reportsTable.reportType })
    .from(reportsTable)
    .where(and(
      eq(reportsTable.transitLineId, transitLineId),
      eq(reportsTable.status, "open"),
      sql`${reportsTable.createdAt} >= ${since}`,
    ));

  if (!rows.length) return res.json({ count: 0, reportType: null });

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.reportType, (counts.get(r.reportType) ?? 0) + 1);
  const topType = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return res.json({ count: rows.length, reportType: topType });
});

const REPORT_TYPES = [
  "wrong_route",
  "wrong_station",
  "wrong_price",
  "missing_transport",
  "closed_station",
  "timing_error",
  "wrong_instructions",
  "other",
];

const STATUSES = ["open", "resolved", "rejected"];
const SERIOUS_ROUTE_REPORTS = new Set(["wrong_route", "wrong_station", "closed_station", "timing_error"]);

router.get("/", requireAdmin, async (req, res) => {
  const { status } = req.query as { status?: string };
  const filters: SQL[] = [];
  if (status && STATUSES.includes(status)) {
    filters.push(eq(reportsTable.status, status));
  }
  const rows = await db
    .select({
      id: reportsTable.id,
      reportType: reportsTable.reportType,
      transitLineId: reportsTable.transitLineId,
      transportTypeId: reportsTable.transportTypeId,
      description: reportsTable.description,
      latitude: reportsTable.latitude,
      longitude: reportsTable.longitude,
      status: reportsTable.status,
      createdAt: reportsTable.createdAt,
      resolvedAt: reportsTable.resolvedAt,
      userName: profilesTable.displayName,
      userPhone: profilesTable.phone,
    })
    .from(reportsTable)
    .leftJoin(profilesTable, eq(profilesTable.userId, reportsTable.userId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(reportsTable.createdAt));
  res.json(rows);
});

router.post("/", requireAuth, async (req, res) => {
  const {
    reportType, transitLineId, transportTypeId, description, latitude, longitude,
    routeLabel, segmentIndex,
  } = req.body;

  if (typeof reportType !== "string" || !REPORT_TYPES.includes(reportType)) {
    return res.status(400).json({ error: "invalid reportType" });
  }

  const resolvedTransitLineId =
    typeof transitLineId === "string" && UUID_RE.test(transitLineId) ? transitLineId : null;
  const resolvedTransportTypeId =
    typeof transportTypeId === "string" && UUID_RE.test(transportTypeId) ? transportTypeId : null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  const contextLines = [
    typeof routeLabel === "string" && routeLabel.trim() ? `Route: ${routeLabel.trim()}` : null,
    segmentIndex !== undefined && segmentIndex !== null ? `Segment index: ${segmentIndex}` : null,
  ].filter(Boolean);
  const comment = typeof description === "string" && description.trim() ? description.trim() : "";
  const fullDescription = [...contextLines, comment ? `Comment: ${comment}` : null].filter(Boolean).join("\n");

  const [row] = await db.insert(reportsTable).values({
    userId: req.userId!,
    reportType,
    transitLineId: resolvedTransitLineId,
    transportTypeId: resolvedTransportTypeId,
    description: fullDescription || null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
    status: "open",
  }).returning();
  if (resolvedTransitLineId) {
    const shouldReview = SERIOUS_ROUTE_REPORTS.has(reportType);
    if (shouldReview) {
      await db
        .update(transitLinesTable)
        .set({
          reviewReportCount: sql`${transitLinesTable.reviewReportCount} + 1`,
          routeStatus: sql`case when ${transitLinesTable.reviewReportCount} + 1 >= 3 then 'needs_review'::route_status else ${transitLinesTable.routeStatus} end`,
          needsReviewReason: sql`case when ${transitLinesTable.reviewReportCount} + 1 >= 3 then ${`repeated ${reportType} reports`} else ${transitLinesTable.needsReviewReason} end`,
          updatedAt: new Date(),
        })
        .where(eq(transitLinesTable.id, resolvedTransitLineId));
    } else {
      await db
        .update(transitLinesTable)
        .set({
          reviewReportCount: sql`${transitLinesTable.reviewReportCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(transitLinesTable.id, resolvedTransitLineId));
    }
  }
  return res.json(row);
});

router.put("/:id", requireAdmin, async (req, res) => {
  const { status } = req.body;
  if (typeof status !== "string" || !STATUSES.includes(status)) {
    return res.status(400).json({ error: "invalid status" });
  }
  const [row] = await db
    .update(reportsTable)
    .set({
      status,
      resolvedAt: status === "resolved" ? new Date() : null,
    })
    .where(eq(reportsTable.id, req.params.id as string))
    .returning();
  if (!row) return res.status(404).json({ error: "report not found" });
  return res.json(row);
});

export default router;
