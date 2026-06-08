import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { phoneSessionsTable } from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";

export async function sessionAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const [session] = await db
      .select()
      .from(phoneSessionsTable)
      .where(and(eq(phoneSessionsTable.token, token), gt(phoneSessionsTable.expiresAt, new Date())))
      .limit(1);

    if (session) {
      req.userId = session.userId;
    }
  }

  next();
}
