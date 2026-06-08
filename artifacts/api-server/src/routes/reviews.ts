import { Router } from "express";
import { db } from "@workspace/db";
import { reviewsTable } from "@workspace/db";
import { eq, desc, and, type SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/", async (req, res) => {
  const filters: SQL[] = [];
  const { transportTypeId, reviewType } = req.query as { transportTypeId?: string; reviewType?: string };
  if (transportTypeId && UUID_RE.test(transportTypeId)) {
    filters.push(eq(reviewsTable.transportTypeId, transportTypeId));
  }
  if (reviewType) {
    filters.push(eq(reviewsTable.reviewType, reviewType));
  }
  const rows = await db
    .select()
    .from(reviewsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(reviewsTable.createdAt));
  res.json(rows);
});

router.post("/", requireAuth, async (req, res) => {
  const {
    rating, comment, transportTypeId, tripSegmentId, tripId,
    reviewType, faceReaction, routeAccurate, timingAccurate,
    qualityGood, stationInfoCorrect, meta,
  } = req.body;

  const numRating = Number(rating);
  if (!Number.isFinite(numRating) || numRating < 1 || numRating > 5) {
    return res.status(400).json({ error: "rating must be between 1 and 5" });
  }

  const resolvedTransportTypeId =
    typeof transportTypeId === "string" && UUID_RE.test(transportTypeId) ? transportTypeId : null;
  const resolvedTripSegmentId =
    typeof tripSegmentId === "string" && UUID_RE.test(tripSegmentId) ? tripSegmentId : null;
  const resolvedTripId =
    typeof tripId === "string" && UUID_RE.test(tripId) ? tripId : null;

  const [row] = await db.insert(reviewsTable).values({
    userId: req.userId!,
    rating: numRating,
    comment: comment ?? null,
    transportTypeId: resolvedTransportTypeId,
    tripSegmentId: resolvedTripSegmentId,
    tripId: resolvedTripId,
    reviewType: typeof reviewType === "string" ? reviewType : "segment",
    faceReaction: faceReaction != null ? Number(faceReaction) : null,
    routeAccurate: typeof routeAccurate === "boolean" ? routeAccurate : null,
    timingAccurate: typeof timingAccurate === "boolean" ? timingAccurate : null,
    qualityGood: typeof qualityGood === "boolean" ? qualityGood : null,
    stationInfoCorrect: typeof stationInfoCorrect === "boolean" ? stationInfoCorrect : null,
    meta: meta ?? null,
  }).returning();
  return res.json(row);
});

router.delete("/:id", requireAdmin, async (req, res) => {
  await db.delete(reviewsTable).where(eq(reviewsTable.id, req.params.id));
  res.json({ success: true });
});

export default router;
