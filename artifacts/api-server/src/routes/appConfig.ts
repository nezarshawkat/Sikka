import { Router } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { clerkAuth } from "../middlewares/clerkAuth";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();
const SETTINGS_KEY = "mobile_app_config";

export interface MobileAppConfig {
  adsEnabled: boolean;
  showAdAfterLocation: boolean;
  showAdAfterTripReview: boolean;
  minimumAndroidVersion: number | null;
  playStoreUrl: string;
}

const defaults: MobileAppConfig = {
  adsEnabled: false,
  showAdAfterLocation: true,
  showAdAfterTripReview: true,
  minimumAndroidVersion: null,
  playStoreUrl: "",
};

function normalizeConfig(value: unknown): MobileAppConfig {
  const input = value && typeof value === "object" ? value as Partial<MobileAppConfig> : {};
  const minimum = Number(input.minimumAndroidVersion);
  return {
    adsEnabled: input.adsEnabled === true,
    showAdAfterLocation: input.showAdAfterLocation !== false,
    showAdAfterTripReview: input.showAdAfterTripReview !== false,
    minimumAndroidVersion: Number.isInteger(minimum) && minimum > 0 ? minimum : null,
    playStoreUrl: typeof input.playStoreUrl === "string" ? input.playStoreUrl.trim() : "",
  };
}

async function readConfig(): Promise<MobileAppConfig> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, SETTINGS_KEY));
  return row ? normalizeConfig(row.value) : defaults;
}

// This endpoint intentionally remains public: the mobile app must be able to
// enforce a required update before the rider signs in.
router.get("/", async (_req, res) => res.json(await readConfig()));

router.put("/", clerkAuth, requireAdmin, async (req, res) => {
  const config = normalizeConfig(req.body);
  await db.insert(appSettingsTable)
    .values({ key: SETTINGS_KEY, value: config, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: config, updatedAt: new Date() } });
  res.json(config);
});

export default router;
