import { Router } from "express";
import { db } from "@workspace/db";
import { transitLinesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

interface TransitLineUpdate {
  lineNumber?: string;
  nameEn?: string;
  nameAr?: string;
  fromArea?: string;
  toArea?: string;
  viaStops?: string[];
  routePath?: unknown;
  priceEgp?: number;
  frequencyMinutes?: number | null;
  hasFixedStops?: boolean;
  isActive?: boolean;
  transportTypeId?: string;
  updatedAt?: Date;
}

router.get("/", async (req, res) => {
  if (req.query.active === "true") {
    const rows = await db.select().from(transitLinesTable).where(eq(transitLinesTable.isActive, true)).orderBy(asc(transitLinesTable.lineNumber));
    return res.json(rows);
  }
  const rows = await db.select().from(transitLinesTable).orderBy(asc(transitLinesTable.lineNumber));
  res.json(rows);
});

router.post("/", requireAdmin, async (req, res) => {
  const { transportTypeId, lineNumber, nameEn, nameAr, fromArea, toArea, viaStops, routePath, priceEgp, frequencyMinutes, hasFixedStops } = req.body;
  const [row] = await db.insert(transitLinesTable).values({
    transportTypeId,
    lineNumber,
    nameEn: nameEn ?? `${lineNumber}: ${fromArea} to ${toArea}`,
    nameAr: nameAr ?? `${lineNumber}: ${fromArea} - ${toArea}`,
    fromArea,
    toArea,
    viaStops: viaStops ?? [],
    routePath: routePath ?? null,
    priceEgp: priceEgp ?? 5,
    frequencyMinutes: frequencyMinutes ?? null,
    hasFixedStops: hasFixedStops ?? false,
  }).returning();
  res.json(row);
});

router.put("/:id", requireAdmin, async (req, res) => {
  const allowed: (keyof TransitLineUpdate)[] = [
    "lineNumber", "nameEn", "nameAr", "fromArea", "toArea", "viaStops",
    "routePath", "priceEgp", "frequencyMinutes", "hasFixedStops", "isActive", "transportTypeId",
  ];
  const updates: TransitLineUpdate = { updatedAt: new Date() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      (updates as Record<keyof TransitLineUpdate, unknown>)[key] = req.body[key];
    }
  }
  const [row] = await db.update(transitLinesTable).set(updates).where(eq(transitLinesTable.id, req.params.id)).returning();
  res.json(row);
});

router.delete("/:id", requireAdmin, async (req, res) => {
  await db.delete(transitLinesTable).where(eq(transitLinesTable.id, req.params.id));
  res.json({ success: true });
});

export default router;
