import { Router } from "express";
import { db } from "@workspace/db";
import { profilesTable, userRolesTable, phoneSessionsTable } from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";
import { getAuth } from "@clerk/express";

const router = Router();

const ADMIN_USER_ID = "sikka-admin";

function normalizePhone(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!/^\+[1-9]\d{7,14}$/.test(raw)) return null;
  return raw;
}

async function twilioVerify(path: string, body: URLSearchParams) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN || process.env.TWILIO_SECRET;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!accountSid || !authToken || !serviceSid) {
    throw new Error("Twilio Verify is not configured");
  }
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${serviceSid}/${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof json?.message === "string" ? json.message : "Twilio Verify request failed");
  }
  return json;
}

router.post("/phone/start", async (req, res) => {
  const phone = normalizePhone(req.body.phoneNumber);
  if (!phone) return res.status(400).json({ error: "A valid E.164 phone number is required" });
  try {
    await twilioVerify("Verifications", new URLSearchParams({ To: phone, Channel: "sms" }));
    return res.json({ success: true });
  } catch (err) {
    return res.status(503).json({ error: err instanceof Error ? err.message : "Could not send verification code" });
  }
});

router.post("/phone/verify", async (req, res) => {
  const phone = normalizePhone(req.body.phoneNumber);
  const code = String(req.body.code ?? "").trim();
  if (!phone || !/^\d{4,10}$/.test(code)) {
    return res.status(400).json({ error: "A valid phone number and code are required" });
  }
  try {
    const result = await twilioVerify("VerificationCheck", new URLSearchParams({ To: phone, Code: code }));
    if (result.status !== "approved") return res.status(401).json({ error: "Invalid verification code" });

    const userId = `phone:${phone}`;
    let [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId)).limit(1);
    if (!profile) {
      [profile] = await db.insert(profilesTable).values({
        userId,
        phone,
        language: "en",
        nationality: "egyptian",
      }).returning();
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.insert(phoneSessionsTable).values({ userId, token, expiresAt });
    return res.json({ token, profile });
  } catch (err) {
    return res.status(503).json({ error: err instanceof Error ? err.message : "Verification failed" });
  }
});

/**
 * POST /api/auth/admin-login
 * Standalone admin login — no Clerk required.
 * Validates ADMIN_USERNAME + ADMIN_PASSWORD, creates a session token.
 */
router.post("/admin-login", async (req, res) => {
  const { username, password } = req.body;
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    res.status(503).json({ error: "Admin credentials are not configured on this server" });
    return;
  }

  if (String(username).trim() !== ADMIN_USERNAME || String(password) !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Invalid admin credentials" });
    return;
  }

  let [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, ADMIN_USER_ID)).limit(1);
  if (!profile) {
    [profile] = await db.insert(profilesTable).values({
      userId: ADMIN_USER_ID,
      language: "en",
      nationality: "egyptian",
      displayName: "Admin",
    }).returning();
  }

  const [existingRole] = await db
    .select()
    .from(userRolesTable)
    .where(and(eq(userRolesTable.userId, ADMIN_USER_ID), eq(userRolesTable.role, "admin")))
    .limit(1);

  if (!existingRole) {
    await db.insert(userRolesTable).values({ userId: ADMIN_USER_ID, role: "admin" });
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.insert(phoneSessionsTable).values({ userId: ADMIN_USER_ID, token, expiresAt });

  res.json({ adminToken: token });
});

/**
 * POST /api/auth/admin-logout
 * Revokes the admin session token.
 */
router.post("/admin-logout", async (req, res) => {
  const token = req.headers["x-admin-token"] as string;
  if (token) {
    await db.delete(phoneSessionsTable).where(eq(phoneSessionsTable.token, token));
  }
  res.json({ success: true });
});

/**
 * POST /api/auth/setup-admin
 * Grants admin role to the currently authenticated Clerk user.
 */
router.post("/setup-admin", async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "You must be signed in with Clerk to set up admin access" });
    return;
  }

  const { username, password } = req.body;
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    res.status(503).json({ error: "Admin credentials are not configured on this server" });
    return;
  }

  if (String(username).trim() !== ADMIN_USERNAME || String(password) !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Invalid admin credentials" });
    return;
  }

  let [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId)).limit(1);
  if (!profile) {
    [profile] = await db.insert(profilesTable).values({
      userId,
      language: "en",
      nationality: "egyptian",
      displayName: "Admin",
    }).returning();
  }

  const [existingRole] = await db
    .select()
    .from(userRolesTable)
    .where(and(eq(userRolesTable.userId, userId), eq(userRolesTable.role, "admin")))
    .limit(1);

  if (!existingRole) {
    await db.insert(userRolesTable).values({ userId, role: "admin" });
  }

  res.json({ success: true, message: "Admin role granted to your account" });
});

export { ADMIN_USER_ID };
export default router;
