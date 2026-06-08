import { Router } from "express";
import { db } from "@workspace/db";
import { reportsTable } from "@workspace/db";
import { eq, desc, and, type SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

router.get("/", requireAdmin, async (req, res) => {
  const { status } = req.query as { status?: string };
  const filters: SQL[] = [];
  if (status && STATUSES.includes(status)) {
    filters.push(eq(reportsTable.status, status));
  }
  const rows = await db
    .select()
    .from(reportsTable)
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
