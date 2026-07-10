import { Router } from "express";
import { db } from "@workspace/db";
import { profilesTable, tripsTable, reviewsTable, transitLinesTable, reportsTable, transportReportsTable } from "@workspace/db";
import { count, eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { countSuspectPaths } from "../engine/graph";

const router = Router();

router.get("/", requireAdmin, async (_req, res) => {
  const [
    users,
    trips,
    reviews,
    routes,
    activeRoutes,
    needsReviewRoutes,
    discoveryRoutes,
    openReports,
    pendingDiscovery,
    pathHealth,
  ] = await Promise.all([
    db.select({ count: count() }).from(profilesTable),
    db.select({ count: count() }).from(tripsTable),
    db.select({ count: count() }).from(reviewsTable),
    db.select({ count: count() }).from(transitLinesTable),
    db.select({ count: count() }).from(transitLinesTable).where(eq(transitLinesTable.routeStatus, "active")),
    db.select({ count: count() }).from(transitLinesTable).where(eq(transitLinesTable.routeStatus, "needs_review")),
    db.select({ count: count() }).from(transitLinesTable).where(eq(transitLinesTable.dataSource, "discovery")),
    db.select({ count: count() }).from(reportsTable).where(eq(reportsTable.status, "open")),
    db.select({ count: count() }).from(transportReportsTable).where(eq(transportReportsTable.status, "pending")),
    countSuspectPaths().catch(() => ({ suspect: 0, total: 0 })),
  ]);

  res.json({
    users: users[0]?.count ?? 0,
    trips: trips[0]?.count ?? 0,
    reviews: reviews[0]?.count ?? 0,
    routes: routes[0]?.count ?? 0,
    activeRoutes: activeRoutes[0]?.count ?? 0,
    needsReviewRoutes: needsReviewRoutes[0]?.count ?? 0,
    discoveryRoutes: discoveryRoutes[0]?.count ?? 0,
    openReports: openReports[0]?.count ?? 0,
    pendingDiscovery: pendingDiscovery[0]?.count ?? 0,
    suspectPaths: pathHealth.suspect,
    suspectPathsTotal: pathHealth.total,
  });
});

export default router;
