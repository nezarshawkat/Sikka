import { Router } from "express";
import { db } from "@workspace/db";
import { transportHeatmapsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

// Public read
router.get("/", async (_req, res) => {
  const rows = await db.select().from(transportHeatmapsTable);
  res.json(rows);
});

// Admin-only writes
router.post("/", requireAdmin, async (req, res) => {
  const { transportTypeId, latitude, longitude, intensity, radiusKm } = req.body;
  const [row] = await db.insert(transportHeatmapsTable).values({
    transportTypeId, latitude, longitude,
    intensity: intensity ?? 0.75,
    radiusKm: radiusKm ?? 1.5,
  }).returning();
  res.json(row);
});

router.delete("/:id", requireAdmin, async (req, res) => {
  await db.delete(transportHeatmapsTable).where(eq(transportHeatmapsTable.id, req.params.id));
  res.json({ success: true });
});

export default router;
