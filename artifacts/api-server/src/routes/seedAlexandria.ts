/**
 * Alexandria APTA (هيئة النقل العام الإسكندرية) bus routes.
 * Source: https://alexapta.gov.eg/خطوط-الأوتوبيس/
 * Alexandria APTA is the government authority (هيئة) equivalent.
 * Routes seeded under "CTA Bus" transport type tagged to Alexandria.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { transportTypesTable, transitLinesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { buildBusRoutePathAI } from "../utils/busPathEnricher";

const router = Router();

interface LineSpec { n: string; r: string }

// Alexandria APTA routes — areas passengers can board/alight anywhere
// Format: line number | stops separated by |
const ALEX_ROUTES: LineSpec[] = [
  { n: "1",  r: "سموحة|سيدي جابر|محطة مصر|اللبان|السيالة|أبو قير" },
  { n: "2",  r: "فيكتوريا|السيوف|الإبراهيمية|محطة الرمل|المنشية|محرم بك|الجمرك|المكس" },
  { n: "3",  r: "محطة مصر|سيدي جابر|العجمي|الهانوفيل|العامرية|برج العرب" },
  { n: "4",  r: "محطة مصر|كرموز|الدخيلة|المكس|بحري" },
  { n: "5",  r: "سيدي بشر|سموحة|المطار|نزلة البحر|أبو قير" },
  { n: "6",  r: "محطة الرمل|اللبان|كوم الدكة|المنشية|الجمرك|مينا البصل|الدخيلة" },
  { n: "7",  r: "محطة مصر|الإسكندرية الجديدة|بورتو مارينا|برج العرب الجديدة" },
  { n: "8",  r: "ستانلي|سيدي جابر|محطة مصر|كرموز|العامرية|برج العرب" },
  { n: "9",  r: "الإسكندرية الجديدة|سيدي بشر|سموحة|سيدي جابر|محطة مصر|المنشية|الجمرك" },
  { n: "10", r: "محطة مصر|الرمل|الأنفوشي|ستانلي|المنتزه|أبو قير" },
  { n: "11", r: "محطة مصر|كرموز|المريوطية|برج العرب" },
  { n: "12", r: "الأندلس|المعمورة|المنتزه|سيدي بشر|الإسكندرية الجديدة|الواجهة البحرية" },
  { n: "13", r: "سيدي جابر|سموحة|محطة مصر|اللبان|بكوس|كوم الدكة|الجمرك|الدخيلة|المكس" },
  { n: "14", r: "فيكتوريا|الإبراهيمية|محطة الرمل|المنشية|الجمرك|مينا البصل|دكروري|كفر الدوار" },
  { n: "15", r: "الأندلس|سيدي بشر|فيكتوريا|الإبراهيمية|محطة مصر|كرموز|العامرية" },
  { n: "16", r: "محطة مصر|سيدي جابر|المعمورة|المنتزه|أبو قير|الرشيد" },
  { n: "17", r: "سموحة|ميامي|الأنفوشي|المنشية|الجمرك|المكس|برج العرب" },
  { n: "18", r: "سيدي بشر|كليوباترا|محطة الرمل|كوم الدكة|الجمرك|الدخيلة" },
  { n: "19", r: "الأندلس|الإبراهيمية|محطة مصر|كرموز|المريوطية|برج العرب الجديدة" },
  { n: "20", r: "محطة مصر|اللبان|بكوس|الشاطبي|المنشية|القبارية|المكس" },
  { n: "21", r: "محطة مصر|سيدي جابر|السيوف|فيكتوريا|ميامي|الأندلس|المنتزه" },
  { n: "22", r: "سموحة|الإسكندرية الجديدة|سيدي بشر|فيكتوريا|الإبراهيمية|محطة الرمل|المنشية" },
  { n: "24", r: "محطة مصر|سيدي جابر|أبو قير|الرشيد" },
  { n: "25", r: "كفر الدوار|دكروري|الجمرك|المنشية|محطة الرمل|الإبراهيمية|سيدي جابر|محطة مصر" },
  { n: "30", r: "برج العرب|العامرية|كرموز|محطة مصر|سيدي جابر|المعمورة" },
  { n: "35", r: "محطة مصر|المريوطية|العامرية|برج العرب الجديدة|مطار برج العرب" },
  { n: "40", r: "سيدي بشر|سموحة|الإسكندرية الجديدة|أبو قير" },
  { n: "45", r: "المنشية|الشاطبي|محطة الرمل|اللبان|كوم الدكة|كرموز|المريوطية" },
  { n: "50", r: "محطة مصر|الجمرك|القبارية|بحري" },
  { n: "55", r: "الأندلس|ميامي|فيكتوريا|الإبراهيمية|محطة الرمل|المنشية|محطة مصر|كرموز|برج العرب" },
  { n: "60", r: "سموحة|سيدي جابر|محطة مصر|المنشية|الجمرك|المكس|الدخيلة|برج العرب" },
];

router.post("/", requireAdmin, async (req, res) => {
  const generatePaths = req.query.generatePaths === "true";
  try {
    const results: string[] = [];

    // Find or create CTA Bus transport type
    const existing = await db.select().from(transportTypesTable)
      .where(eq(transportTypesTable.nameEn, "CTA Bus")).limit(1);
    let typeId: string;
    if (existing.length > 0) {
      typeId = existing[0].id;
      results.push("Using existing CTA Bus type");
    } else {
      const [ins] = await db.insert(transportTypesTable).values({
        nameEn: "CTA Bus", nameAr: "أتوبيس الهيئة",
        icon: "bus", color: "#DC2626",
        basePriceEgp: 13, pricePerKmEgp: 0, averageSpeedKmh: 20,
        foreignerAllowed: true, isActive: true,
      }).returning();
      typeId = ins.id;
      results.push("Created CTA Bus transport type");
    }

    for (const line of ALEX_ROUTES) {
      const lineNum = `ALEX-${line.n}`;
      const stops = line.r.split("|").map(s => s.trim()).filter(Boolean);
      const fromArea = stops[0];
      const toArea = stops[stops.length - 1];
      const viaStops = stops.slice(1, -1);

      const ex = await db.select().from(transitLinesTable)
        .where(eq(transitLinesTable.lineNumber, lineNum)).limit(1);
      if (ex.length > 0) { results.push(`Skip: ${lineNum}`); continue; }

      let routePath = null;
      if (generatePaths) {
        try {
          routePath = (await buildBusRoutePathAI(fromArea, toArea, viaStops, "Alexandria")).routePath;
        } catch { /* ignore */ }
      }

      await db.insert(transitLinesTable).values({
        transportTypeId: typeId,
        lineNumber: lineNum,
        nameEn: `Alex APTA Line ${line.n}: ${fromArea} → ${toArea}`,
        nameAr: `خط الإسكندرية ${line.n}: ${fromArea} - ${toArea}`,
        fromArea, toArea, viaStops,
        priceEgp: 13, isActive: true,
        frequencyMinutes: 15, hasFixedStops: false,
        routePath: routePath,
      });
      results.push(`Seeded: Alex Line ${line.n}${generatePaths && routePath ? " (with path)" : ""}`);
    }

    res.json({ success: true, count: results.filter(r => r.startsWith("Seeded")).length, results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Alex seed error:", err);
    res.status(500).json({ error: msg });
  }
});

export default router;
