import { Router } from "express";
import { db } from "@workspace/db";
import { reviewsTable, transitLinesTable, profilesTable } from "@workspace/db";
import { eq, desc, and, sql, type SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function metaTransitLineId(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as { transitLineId?: unknown }).transitLineId;
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

function metaTransportNumber(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as { lineNumber?: unknown }).lineNumber;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

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
    .select({
      id: reviewsTable.id,
      rating: reviewsTable.rating,
      comment: reviewsTable.comment,
      reviewType: reviewsTable.reviewType,
      faceReaction: reviewsTable.faceReaction,
      routeAccurate: reviewsTable.routeAccurate,
      timingAccurate: reviewsTable.timingAccurate,
      qualityGood: reviewsTable.qualityGood,
      stationInfoCorrect: reviewsTable.stationInfoCorrect,
      transportTypeId: reviewsTable.transportTypeId,
      transitLineId: reviewsTable.transitLineId,
      tripId: reviewsTable.tripId,
      tripSegmentId: reviewsTable.tripSegmentId,
      meta: reviewsTable.meta,
      createdAt: reviewsTable.createdAt,
      userName: profilesTable.displayName,
      userPhone: profilesTable.phone,
    })
    .from(reviewsTable)
    .leftJoin(profilesTable, eq(profilesTable.userId, reviewsTable.userId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(reviewsTable.createdAt));

  // Backfill transitLineId / transportNumber from legacy meta for older rows
  const enriched = rows.map((row) => ({
    ...row,
    transitLineId: row.transitLineId ?? metaTransitLineId(row.meta),
    transportNumber: metaTransportNumber(row.meta),
    transportName: (row.meta as { transportName?: string } | null)?.transportName ?? undefined,
  }));
  res.json(enriched);
});

router.post("/", requireAuth, async (req, res) => {
  const {
    rating, comment, transportTypeId, transitLineId, tripSegmentId, tripId,
    reviewType, faceReaction, routeAccurate, timingAccurate,
    qualityGood, stationInfoCorrect, meta,
  } = req.body;

  const numRating = Number(rating);
  if (!Number.isFinite(numRating) || numRating < 1 || numRating > 5) {
    return res.status(400).json({ error: "rating must be between 1 and 5" });
  }

  const resolvedTransportTypeId =
    typeof transportTypeId === "string" && UUID_RE.test(transportTypeId) ? transportTypeId : null;
  const resolvedTransitLineId =
    typeof transitLineId === "string" && UUID_RE.test(transitLineId)
      ? transitLineId
      : metaTransitLineId(meta);
  const resolvedTripSegmentId =
    typeof tripSegmentId === "string" && UUID_RE.test(tripSegmentId) ? tripSegmentId : null;
  const resolvedTripId =
    typeof tripId === "string" && UUID_RE.test(tripId) ? tripId : null;

  const [row] = await db.insert(reviewsTable).values({
    userId: req.userId!,
    rating: numRating,
    comment: comment ?? null,
    transportTypeId: resolvedTransportTypeId,
    transitLineId: resolvedTransitLineId,
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
  if (resolvedTransitLineId && (routeAccurate === false || qualityGood === false)) {
    await db
      .update(transitLinesTable)
      .set({
        reviewReportCount: sql`${transitLinesTable.reviewReportCount} + 1`,
        routeStatus: sql`case when ${transitLinesTable.reviewReportCount} + 1 >= 3 then 'needs_review'::route_status else ${transitLinesTable.routeStatus} end`,
        needsReviewReason: sql`case when ${transitLinesTable.reviewReportCount} + 1 >= 3 then 'repeated low route reviews' else ${transitLinesTable.needsReviewReason} end`,
        updatedAt: new Date(),
      })
      .where(eq(transitLinesTable.id, resolvedTransitLineId));
  }
  return res.json(row);
});

router.delete("/:id", requireAdmin, async (req, res) => {
  await db.delete(reviewsTable).where(eq(reviewsTable.id, req.params.id));
  res.json({ success: true });
});

export default router;
