import { Router } from "express";
import { db } from "@workspace/db";
import { mawaqefTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

interface MawqefUpdate {
  nameEn?: string;
  nameAr?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  transportTypeIds?: string[];
  isActive?: boolean;
  descriptionEn?: string;
  descriptionAr?: string;
}

router.get("/", async (req, res) => {
  if (req.query.active === "true") {
    const rows = await db.select().from(mawaqefTable).where(eq(mawaqefTable.isActive, true)).orderBy(asc(mawaqefTable.nameAr));
    return res.json(rows);
  }
  const rows = await db.select().from(mawaqefTable).orderBy(asc(mawaqefTable.nameAr));
  res.json(rows);
});

router.post("/", requireAdmin, async (req, res) => {
  const { nameEn, nameAr, city, latitude, longitude, transportTypeIds, descriptionEn, descriptionAr } = req.body;
  const [row] = await db.insert(mawaqefTable).values({
    nameEn, nameAr,
    city: city ?? "cairo",
    latitude, longitude,
    transportTypeIds: transportTypeIds ?? [],
    descriptionEn, descriptionAr,
  }).returning();
  res.json(row);
});

router.put("/:id", requireAdmin, async (req, res) => {
  const allowed: (keyof MawqefUpdate)[] = [
    "nameEn", "nameAr", "city", "latitude", "longitude",
    "transportTypeIds", "isActive", "descriptionEn", "descriptionAr",
  ];
  const updates: MawqefUpdate = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      (updates as Record<keyof MawqefUpdate, unknown>)[key] = req.body[key];
    }
  }
  const [row] = await db.update(mawaqefTable).set(updates).where(eq(mawaqefTable.id, req.params.id)).returning();
  res.json(row);
});

router.delete("/:id", requireAdmin, async (req, res) => {
  await db.delete(mawaqefTable).where(eq(mawaqefTable.id, req.params.id));
  res.json({ success: true });
});

export default router;
