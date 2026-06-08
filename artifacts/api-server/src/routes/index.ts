import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import profileRouter from "./profile";
import transportTypesRouter from "./transportTypes";
import transitLinesRouter from "./transitLines";
import locationsRouter from "./locations";
import mawaqefRouter from "./mawaqef";
import reviewsRouter from "./reviews";
import tripsRouter from "./trips";
import heatmapsRouter from "./heatmaps";
import analyticsRouter from "./analytics";
import tripPlanRouter from "./tripPlan";
import seedCairoRouter from "./seedCairo";
import seedAlexandriaRouter from "./seedAlexandria";
import seedFromCSVRouter from "./seedFromCSV";
import seedHeatmapsRouter from "./seedHeatmaps";
import seedStopsRouter from "./seedStops";
import seedGtfsRouter from "./seedGtfs";
import reEnrichRoutesRouter from "./reEnrichRoutes";
import intercityRouter from "./intercity";
import reportsRouter from "./reports";
import transportReportsRouter from "./transportReports";
import { clerkAuth } from "../middlewares/clerkAuth";

const router: IRouter = Router();

// Public — no auth needed
router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/intercity", intercityRouter);

// Populate req.userId from Clerk session on all remaining routes
router.use(clerkAuth);

// Resources: auth enforcement is applied per-method inside each router file
router.use("/transport-types", transportTypesRouter);
router.use("/transit-lines", transitLinesRouter);
router.use("/locations", locationsRouter);
router.use("/mawaqef", mawaqefRouter);
router.use("/heatmaps", heatmapsRouter);
router.use("/reviews", reviewsRouter);
router.use("/reports", reportsRouter);
router.use("/transport-reports", transportReportsRouter);
router.use("/analytics", analyticsRouter);

// Seed endpoints — admin-only, governorate-specific
// POST /api/admin/seed-cairo              — Metro, Monorail, Train, NTA Bus, Serfis
// POST /api/admin/seed-cairo?section=nta  — NTA Bus only
// POST /api/admin/seed-cairo?generatePaths=true — also geocode + snap to roads
// POST /api/admin/seed-alexandria         — Alexandria APTA routes
// POST /api/admin/seed-alexandria?generatePaths=true
router.use("/admin/seed-cairo", seedCairoRouter);
router.use("/admin/seed-alexandria", seedAlexandriaRouter);
router.use("/admin/seed-from-csv", seedFromCSVRouter);
// POST /api/admin/seed-heatmaps — Tuktuk + White Taxi density hotspots
router.use("/admin/seed-heatmaps", seedHeatmapsRouter);
// POST /api/admin/seed-stops — geo-located stop dictionary (locations + mawaqef) + microbus coverage
router.use("/admin/seed-stops", seedStopsRouter);
// POST /api/admin/seed-gtfs — authoritative Transport-for-Cairo GTFS (Metro replace + bus/serfis/microbus merge)
// POST /api/admin/seed-gtfs?dryRun=true — report changes without writing
router.use("/admin/seed-gtfs", seedGtfsRouter);
// POST /api/admin/re-enrich-routes?transportMode=bus&limit=N&offset=M
//   — small incremental batches re-snapping board-anywhere route_path to main streets
router.use("/admin/re-enrich-routes", reEnrichRoutesRouter);

// User-scoped routes
router.use("/profile", profileRouter);
router.use("/trips/plan", tripPlanRouter);
router.use("/trips", tripsRouter);

export default router;
