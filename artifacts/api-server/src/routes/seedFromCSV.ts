import { Router } from "express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { db } from "@workspace/db";
import { transitLinesTable, transportTypesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import fs from "fs";
import path from "path";

const router = Router();

// Latest uploaded CSV filenames (attached_assets)
const CSV_FILES = {
  nta: "NTA_Busses_data_Cairo_1780323547442.csv",
  cta: "Cairo_Bus_Lines_All_1780318927059.csv",
  microbus: "Cairo_Microbus_Full_Data_1780318927060.csv",
  serfis: "serfis_with_stations_1780323656593.csv",
};

function parsePriceEGP(str: string): number {
  if (!str || str.trim() === "-") return 0;
  const s = str.toString().trim();
  const parts = s.split(/\s*-\s*/);
  const first = parts[0];
  const m = first.match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}

function parseArabicStops(raw: string): string[] {
  if (!raw || raw.trim() === "-") return [];
  return raw.split(/[,،]/).map((s) => s.trim()).filter(Boolean);
}

// Stops listed in the المسار / خطوط السير column, separated by dashes or dots.
function parseRouteStops(raw: string): string[] {
  if (!raw || raw.trim() === "-") return [];
  return raw
    .split(/\s+[-–—.]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === "," && !inQ) { result.push(cur.trim()); cur = ""; }
    else { cur += ch; }
  }
  result.push(cur.trim());
  return result;
}

function readAttached(filename: string): string {
  const candidates = [
    path.join("/home/runner/workspace/attached_assets", filename),
    path.join(process.cwd(), "../../attached_assets", filename),
    path.join(process.cwd(), "../../../attached_assets", filename),
  ];
  for (const p of candidates) {
    try { return fs.readFileSync(p, "utf-8"); } catch {}
  }
  throw new Error(`Cannot find attached file: ${filename}`);
}

async function getTypeId(nameEn: string): Promise<string | null> {
  const [row] = await db.select().from(transportTypesTable)
    .where(eq(transportTypesTable.nameEn, nameEn)).limit(1);
  return row?.id ?? null;
}

async function insertLine(opts: {
  transportTypeId: string;
  lineNumber: string | null;
  nameAr: string;
  nameEn: string;
  fromArea: string;
  toArea: string;
  viaStops: string[];
  priceEgp: number;
  governorate?: string;
}): Promise<"seeded" | "skipped"> {
  try {
    await db.insert(transitLinesTable).values({
      transportTypeId: opts.transportTypeId,
      lineNumber: opts.lineNumber || null,
      nameAr: opts.nameAr,
      nameEn: opts.nameEn,
      fromArea: opts.fromArea,
      toArea: opts.toArea,
      governorate: opts.governorate || "Cairo",
      viaStops: opts.viaStops,
      priceEgp: opts.priceEgp,
      hasFixedStops: false,
      isActive: true,
    });
    return "seeded";
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "23505") return "skipped";
    throw e;
  }
}

export type SeedResult = {
  success: boolean;
  seeded: number;
  skipped: number;
  cleared: number;
  breakdown: { ntaBus: number; ctaBus: number; microbus: number; serfis: number; skipped: number };
  errors: string[];
};

export async function runCSVSeed(opts: { clearFirst?: boolean } = {}): Promise<SeedResult> {
  const counts = { ntaBus: 0, ctaBus: 0, microbus: 0, serfis: 0, skipped: 0 };
  const errors: string[] = [];
  let cleared = 0;

  const [ntaId, ctaId, microbusId, serfisId] = await Promise.all([
    getTypeId("NTA Bus"),
    getTypeId("CTA Bus"),
    getTypeId("Microbus"),
    getTypeId("Serfis"),
  ]);

  if (!ntaId || !ctaId || !microbusId || !serfisId) {
    throw new Error(
      `One or more transport types missing. Run POST /api/admin/seed-cairo first. found=${JSON.stringify({ ntaId, ctaId, microbusId, serfisId })}`,
    );
  }

  // ── Clear existing bus + serfis + microbus lines (Metro/Monorail/Train kept) ──
  if (opts.clearFirst) {
    const deleted = await db
      .delete(transitLinesTable)
      .where(inArray(transitLinesTable.transportTypeId, [ntaId, ctaId, microbusId, serfisId]))
      .returning({ id: transitLinesTable.id });
    cleared = deleted.length;
  }

  // ── NTA Buses ────────────────────────────────────────────────────────────────
  // Columns: رقم الخط, المسار, المواقف, التعريفة
  try {
    const raw = readAttached(CSV_FILES.nta);
    const lines = raw.replace(/^\uFEFF/, "").split("\n").filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < 3) continue;
      const lineNum = cols[0]?.trim() || null;
      const routeAr = cols[1]?.trim() || "";
      const price = parsePriceEGP(cols[3] || "20");

      // Full stops live in المسار (cols[1]); المواقف is often empty.
      const stops = parseRouteStops(routeAr);
      if (stops.length < 2) continue;
      const fromArea = stops[0];
      const toArea = stops[stops.length - 1];
      const viaStops = stops.slice(1, -1);

      const nameAr = lineNum ? `خط ${lineNum}: ${fromArea} → ${toArea}` : `${fromArea} → ${toArea}`;
      const nameEn = lineNum ? `NTA Line ${lineNum}` : `NTA Route`;

      const result = await insertLine({
        transportTypeId: ntaId,
        lineNumber: lineNum,
        nameAr,
        nameEn,
        fromArea,
        toArea,
        viaStops,
        priceEgp: price,
        governorate: "Cairo",
      });
      if (result === "seeded") counts.ntaBus++;
      else counts.skipped++;
    }
  } catch (e) {
    errors.push(`NTA Bus: ${(e as Error).message}`);
  }

  // ── CTA Buses (Cairo Bus Lines) ───────────────────────────────────────────
  // Columns: رقم الخط, المواقف, السعر
  try {
    const raw = readAttached(CSV_FILES.cta);
    const lines = raw.replace(/^\uFEFF/, "").split("\n").filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < 2) continue;
      const lineNum = cols[0]?.trim() || null;
      const stopsRaw = cols[1]?.trim() || "";
      const price = parsePriceEGP(cols[2] || "20");

      const stops = parseArabicStops(stopsRaw);
      const fromArea = stops[0] || "";
      const toArea = stops[stops.length - 1] || "";
      const viaStops = stops.slice(1, -1);

      const nameAr = lineNum ? `خط ${lineNum}: ${fromArea} → ${toArea}` : `${fromArea} → ${toArea}`;
      const nameEn = lineNum ? `CTA Line ${lineNum}` : `CTA Route`;

      const result = await insertLine({
        transportTypeId: ctaId,
        lineNumber: lineNum,
        nameAr,
        nameEn,
        fromArea,
        toArea,
        viaStops,
        priceEgp: price,
        governorate: "Cairo",
      });
      if (result === "seeded") counts.ctaBus++;
      else counts.skipped++;
    }
  } catch (e) {
    errors.push(`CTA Bus: ${(e as Error).message}`);
  }

  // ── Microbus ──────────────────────────────────────────────────────────────
  // Columns: رقم الخط, خط السير, المواقف, السعر
  try {
    const raw = readAttached(CSV_FILES.microbus);
    const lines = raw.replace(/^\uFEFF/, "").split("\n").filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < 3) continue;
      const routeAr = cols[1]?.trim() || "";
      const stopsRaw = cols[2]?.trim() || "";
      const price = parsePriceEGP(cols[3] || "8");

      const routeParts = routeAr.split(/\s*-\s*/);
      const stops = parseArabicStops(stopsRaw);
      const fromArea = routeParts[0]?.trim() || stops[0] || "";
      const toArea = routeParts[routeParts.length - 1]?.trim() || stops[stops.length - 1] || "";
      const viaStops = stops.slice(1, -1);

      const nameAr = routeAr || `${fromArea} → ${toArea}`;
      const nameEn = `Microbus: ${fromArea} → ${toArea}`;

      const result = await insertLine({
        transportTypeId: microbusId,
        lineNumber: null, // microbus lines have no fixed number
        nameAr,
        nameEn,
        fromArea,
        toArea,
        viaStops,
        priceEgp: price,
        governorate: "Cairo",
      });
      if (result === "seeded") counts.microbus++;
      else counts.skipped++;
    }
  } catch (e) {
    errors.push(`Microbus: ${(e as Error).message}`);
  }

  // ── Serfis ────────────────────────────────────────────────────────────────
  // Columns: م, خطوط السير, المواقف, التعريفة الحالية (جنية), (قرش), بعد الزيادة (جنية), (قرش)
  try {
    const raw = readAttached(CSV_FILES.serfis);
    const lines = raw.replace(/^\uFEFF/, "").split("\n").filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < 4) continue;
      const lineNum = cols[0]?.trim() || null;
      const routeAr = cols[1]?.trim() || "";
      const pricePounds = parseFloat(cols[5] || cols[3] || "8") || 0;
      const pricePiastres = parseFloat(cols[6] || cols[4] || "0") || 0;
      const price = pricePounds + pricePiastres / 100;

      // Full stops live in خطوط السير (cols[1]).
      const stops = parseRouteStops(routeAr);
      if (stops.length < 2) continue;
      const fromArea = stops[0];
      const toArea = stops[stops.length - 1];
      const viaStops = stops.slice(1, -1);

      const nameAr = routeAr || `${fromArea} → ${toArea}`;
      const nameEn = lineNum ? `Serfis Line ${lineNum}` : `Serfis Route`;

      const result = await insertLine({
        transportTypeId: serfisId,
        lineNumber: lineNum,
        nameAr,
        nameEn,
        fromArea,
        toArea,
        viaStops,
        priceEgp: price,
        governorate: "Cairo",
      });
      if (result === "seeded") counts.serfis++;
      else counts.skipped++;
    }
  } catch (e) {
    errors.push(`Serfis: ${(e as Error).message}`);
  }

  const total = counts.ntaBus + counts.ctaBus + counts.microbus + counts.serfis;
  return {
    success: errors.length === 0,
    seeded: total,
    skipped: counts.skipped,
    cleared,
    breakdown: counts,
    errors,
  };
}

router.post("/", requireAdmin, async (req, res) => {
  try {
    const clearFirst = req.query.clear === "true" || req.body?.clear === true;
    const result = await runCSVSeed({ clearFirst });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

export default router;
