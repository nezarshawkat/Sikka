import { Router } from "express";
import { db } from "@workspace/db";
import { tripsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const rows = await db.select().from(tripsTable).where(eq(tripsTable.userId, req.userId!)).orderBy(desc(tripsTable.createdAt));
  res.json(rows);
});

router.post("/", requireAuth, async (req, res) => {
  const {
    startLat, startLng, endLat, endLng, destinationName,
    budgetEgp, tripType, totalCostEgp, totalTimeMinutes,
  } = req.body;
  const sLat = Number(startLat);
  const sLng = Number(startLng);
  const eLat = Number(endLat);
  const eLng = Number(endLng);
  if (![sLat, sLng, eLat, eLng].every(Number.isFinite)) {
    return res.status(400).json({ error: "valid trip coordinates are required" });
  }
  const cleanTripType = typeof tripType === "string" && tripType.trim() ? tripType.trim().slice(0, 60) : "economic";
  const [row] = await db.insert(tripsTable).values({
    userId: req.userId!,
    startLat: sLat,
    startLng: sLng,
    endLat: eLat,
    endLng: eLng,
    destinationName: typeof destinationName === "string" && destinationName.trim() ? destinationName.trim().slice(0, 240) : null,
    budgetEgp: Number.isFinite(Number(budgetEgp)) ? Number(budgetEgp) : null,
    tripType: cleanTripType,
    totalCostEgp: Number.isFinite(Number(totalCostEgp)) ? Number(totalCostEgp) : null,
    totalTimeMinutes: Number.isFinite(Number(totalTimeMinutes)) ? Math.round(Number(totalTimeMinutes)) : null,
  }).returning();
  res.json(row);
});

export default router;
