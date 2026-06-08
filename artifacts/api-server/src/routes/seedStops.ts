/**
 * POST /api/admin/seed-stops — admin only.
 *
 * Rebuilds the geo-located stop dictionary (locations + mawaqef) and microbus
 * coverage heatmaps from verified transit_line route geometry. Idempotent.
 * See utils/importStopsDictionary.ts for the algorithm.
 */
import { Router } from "express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { runStopImport } from "../utils/importStopsDictionary";

const router = Router();

router.post("/", requireAdmin, async (_req, res) => {
  try {
    const summary = await runStopImport();
    return res.json({ success: true, ...summary });
  } catch (err) {
    console.error("seed-stops error:", err);
    return res.status(500).json({ error: "Failed to import stop dictionary" });
  }
});

export default router;
