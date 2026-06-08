import { Router } from "express";
import { db } from "@workspace/db";
import { profilesTable, tripsTable, reviewsTable, transitLinesTable } from "@workspace/db";
import { count } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { countSuspectPaths } from "../engine/graph";

const router = Router();

router.get("/", requireAdmin, async (_req, res) => {
  const [users, trips, reviews, routes, pathHealth] = await Promise.all([
    db.select({ count: count() }).from(profilesTable),
    db.select({ count: count() }).from(tripsTable),
    db.select({ count: count() }).from(reviewsTable),
    db.select({ count: count() }).from(transitLinesTable),
    countSuspectPaths().catch(() => ({ suspect: 0, total: 0 })),
  ]);

  res.json({
    users: users[0]?.count ?? 0,
    trips: trips[0]?.count ?? 0,
    reviews: reviews[0]?.count ?? 0,
    routes: routes[0]?.count ?? 0,
    suspectPaths: pathHealth.suspect,
    suspectPathsTotal: pathHealth.total,
  });
});

export default router;
