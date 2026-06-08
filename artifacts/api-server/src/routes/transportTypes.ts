import { Router } from "express";
import { db } from "@workspace/db";
import { transportTypesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

interface TransportTypeUpdate {
  nameEn?: string;
  nameAr?: string;
  icon?: string;
  color?: string;
  averageSpeedKmh?: number;
  basePriceEgp?: number;
  pricePerKmEgp?: number;
  isActive?: boolean;
  foreignerAllowed?: boolean;
  serviceLevel?: string;
  minDistanceMinutes?: number;
  maxDistanceMinutes?: number;
}

router.get("/", async (_req, res) => {
  const rows = await db.select().from(transportTypesTable).orderBy(asc(transportTypesTable.nameEn));
  res.json(rows);
});

router.post("/", requireAdmin, async (req, res) => {
  const { nameEn, nameAr, icon, color, averageSpeedKmh, basePriceEgp, pricePerKmEgp, serviceLevel, foreignerAllowed } = req.body;
  const [row] = await db.insert(transportTypesTable).values({
    nameEn: nameEn ?? "New Transport",
    nameAr: nameAr ?? "مواصلات جديدة",
    icon: icon ?? "bus",
    color: color ?? "#3B82F6",
    averageSpeedKmh: averageSpeedKmh ?? 30,
    basePriceEgp: basePriceEgp ?? 5,
    pricePerKmEgp: pricePerKmEgp ?? 1,
    serviceLevel: serviceLevel ?? "standard",
    foreignerAllowed: foreignerAllowed !== false,
  }).returning();
  res.json(row);
});

router.put("/:id", requireAdmin, async (req, res) => {
  const allowed: (keyof TransportTypeUpdate)[] = [
    "nameEn", "nameAr", "icon", "color", "averageSpeedKmh", "basePriceEgp",
    "pricePerKmEgp", "isActive", "foreignerAllowed", "serviceLevel",
    "minDistanceMinutes", "maxDistanceMinutes",
  ];
  const updates: TransportTypeUpdate = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      (updates as Record<keyof TransportTypeUpdate, unknown>)[key] = req.body[key];
    }
  }
  const [row] = await db.update(transportTypesTable).set(updates).where(eq(transportTypesTable.id, req.params.id)).returning();
  res.json(row);
});

router.delete("/:id", requireAdmin, async (req, res) => {
  await db.delete(transportTypesTable).where(eq(transportTypesTable.id, req.params.id));
  res.json({ success: true });
});

export default router;
