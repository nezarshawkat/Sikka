import { Router } from "express";
import { db } from "@workspace/db";
import { profilesTable, userRolesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

interface ProfileUpdate {
  language?: string;
  nationality?: string;
  displayName?: string | null;
  updatedAt?: Date;
}

router.get("/", requireAuth, async (req, res) => {
  let [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, req.userId!))
    .limit(1);

  if (!profile) {
    [profile] = await db
      .insert(profilesTable)
      .values({ userId: req.userId!, language: "en", nationality: "egyptian" })
      .returning();
  }

  const [roleRow] = await db
    .select()
    .from(userRolesTable)
    .where(and(eq(userRolesTable.userId, req.userId!), eq(userRolesTable.role, "admin")))
    .limit(1);

  res.json({ ...profile, isAdmin: !!roleRow });
});

router.put("/", requireAuth, async (req, res) => {
  const { language, nationality, displayName } = req.body;
  const updates: ProfileUpdate = { updatedAt: new Date() };
  if (language !== undefined) updates.language = language;
  if (nationality !== undefined) updates.nationality = nationality;
  if (displayName !== undefined) updates.displayName = displayName;

  const [existing] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, req.userId!))
    .limit(1);

  if (!existing) {
    const [created] = await db
      .insert(profilesTable)
      .values({ userId: req.userId!, language: "en", nationality: "egyptian", ...updates })
      .returning();
    res.json(created);
    return;
  }

  const [updated] = await db
    .update(profilesTable)
    .set(updates)
    .where(eq(profilesTable.userId, req.userId!))
    .returning();
  res.json(updated);
});

export default router;
