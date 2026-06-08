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
  const { startLat, startLng, endLat, endLng, destinationName, budgetEgp, tripType } = req.body;
  const [row] = await db.insert(tripsTable).values({
    userId: req.userId!,
    startLat, startLng, endLat, endLng,
    destinationName, budgetEgp, tripType,
  }).returning();
  res.json(row);
});

export default router;
