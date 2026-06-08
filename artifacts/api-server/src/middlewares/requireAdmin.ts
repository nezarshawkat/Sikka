import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { userRolesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const [role] = await db
    .select()
    .from(userRolesTable)
    .where(and(eq(userRolesTable.userId, req.userId), eq(userRolesTable.role, "admin")))
    .limit(1);

  if (!role) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  next();
}
