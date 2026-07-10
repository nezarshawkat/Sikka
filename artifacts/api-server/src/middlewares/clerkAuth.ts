import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { phoneSessionsTable } from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";

export async function clerkAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const clerkAuth = getAuth(req);
  if (clerkAuth?.userId) {
    req.userId = clerkAuth.userId;
    return next();
  }

  const adminToken = req.headers["x-admin-token"] as string | undefined;
  const authorization = req.headers.authorization;
  const bearerToken = authorization?.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : undefined;
  const sessionToken = adminToken || bearerToken;
  if (sessionToken) {
    try {
      const [session] = await db
        .select()
        .from(phoneSessionsTable)
        .where(
          and(
            eq(phoneSessionsTable.token, sessionToken),
            gt(phoneSessionsTable.expiresAt, new Date()),
          ),
        )
        .limit(1);

      if (session) {
        req.userId = session.userId;
      }
    } catch {
    }
  }

  next();
}
