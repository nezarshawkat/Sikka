import { Router } from "express";
import { db } from "@workspace/db";
import { profilesTable, tripsTable, reviewsTable, transitLinesTable, reportsTable, transportReportsTable } from "@workspace/db";
import { count, eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { countSuspectPaths } from "../engine/graph";

const router = Router();

function normalizeNationalityLabel(value: string | null | undefined): string {
  const clean = (value ?? "").trim();
  if (!clean) return "Unknown";
  const key = clean.toLowerCase();
  if (["eg", "egypt", "egyptian", "egyptians", "مصر", "مصري", "مصرى", "مصرية"].includes(key)) {
    return "Egyptian";
  }
  if (["foreigner", "foreign", "foreigns", "foriegn", "foriegns"].includes(key)) {
    return "Foreign";
  }
  return clean
    .split(/\s+/)
    .map((part) => part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part)
    .join(" ");
}

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
    nationalities,
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
    db
      .select({ nationality: profilesTable.nationality, count: count() })
      .from(profilesTable)
      .groupBy(profilesTable.nationality),
  ]);

  const nationalityMap = new Map<string, number>();
  for (const row of nationalities) {
    const label = normalizeNationalityLabel(row.nationality);
    nationalityMap.set(label, (nationalityMap.get(label) ?? 0) + (Number(row.count) || 0));
  }

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
    nationalities: [...nationalityMap.entries()]
      .map(([nationality, count]) => ({ nationality, count }))
      .sort((a, b) => b.count - a.count || a.nationality.localeCompare(b.nationality)),
  });
});

export default router;
