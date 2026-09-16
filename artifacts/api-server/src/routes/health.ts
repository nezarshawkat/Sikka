import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getDatabaseStatus } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const database = getDatabaseStatus();
  const data = HealthCheckResponse.parse({
    status: `ok (database: ${database.activeTarget}${database.failoverConfigured ? ", failover configured" : ""})`,
  });
  res.json(data);
});

export default router;
