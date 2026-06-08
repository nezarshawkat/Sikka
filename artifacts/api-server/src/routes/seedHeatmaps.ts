/**
 * Density heatmaps for transport types that have no fixed routes
 * (Tuktuk توك توك and White Taxi تاكسي أبيض).
 *
 * Hotspot locations are sourced from public reporting on Greater Cairo:
 *  - Tuk-tuk concentration follows the Cairo Governorate 2024 vehicle census
 *    (Al-Muqattam ~29%, Helwan ~14%, Hadayek El-Qubba, El-Zawya El-Hamra,
 *    El-Sahel, El-Basateen) plus well-documented informal-area hubs
 *    (Manshiyat Naser, Dar El-Salam, Ain Shams, El-Matareya).
 *  - White-taxi density follows the major downtown ranks and transport nodes
 *    (Tahrir, Ramses, Egyptian Museum, Zamalek, Giza/Pyramids, Heliopolis,
 *    Nasr City, Mohandessin, Maadi, Cairo Airport).
 *
 * Intensity is a 0–1 weight (relative demand); radiusKm is the spread.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { transportTypesTable, transportHeatmapsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

interface HeatPoint {
  name: string;
  lat: number;
  lng: number;
  intensity: number;
  radiusKm: number;
}

// Tuk-tuk (توك توك) hotspots — informal/peripheral districts of Greater Cairo.
const TUKTUK_POINTS: HeatPoint[] = [
  { name: "Al-Muqattam (المقطم)", lat: 30.0254, lng: 31.2939, intensity: 1.0, radiusKm: 2.5 },
  { name: "Helwan (حلوان)", lat: 29.8500, lng: 31.3340, intensity: 0.85, radiusKm: 3.0 },
  { name: "Hadayek El-Qubba (حدائق القبة)", lat: 30.0900, lng: 31.2870, intensity: 0.72, radiusKm: 1.8 },
  { name: "El-Zawya El-Hamra (الزاوية الحمراء)", lat: 30.0970, lng: 31.2740, intensity: 0.70, radiusKm: 1.8 },
  { name: "El-Sahel (الساحل)", lat: 30.0890, lng: 31.2530, intensity: 0.68, radiusKm: 1.8 },
  { name: "El-Basateen (البساتين)", lat: 29.9930, lng: 31.2790, intensity: 0.67, radiusKm: 2.0 },
  { name: "Manshiyat Naser (منشأة ناصر)", lat: 30.0380, lng: 31.2820, intensity: 0.80, radiusKm: 1.6 },
  { name: "Dar El-Salam (دار السلام)", lat: 29.9870, lng: 31.2510, intensity: 0.66, radiusKm: 1.8 },
  { name: "Ain Shams (عين شمس)", lat: 30.1310, lng: 31.3270, intensity: 0.64, radiusKm: 2.0 },
  { name: "El-Matareya (المطرية)", lat: 30.1230, lng: 31.3090, intensity: 0.62, radiusKm: 2.0 },
  { name: "Imbaba (إمبابة)", lat: 30.0770, lng: 31.2070, intensity: 0.70, radiusKm: 2.2 },
  { name: "Boulaq El-Dakrour (بولاق الدكرور)", lat: 30.0290, lng: 31.1930, intensity: 0.66, radiusKm: 2.0 },
];

// White taxi (تاكسي أبيض) hotspots — central ranks and major transport nodes.
const WHITE_TAXI_POINTS: HeatPoint[] = [
  { name: "Tahrir Square (ميدان التحرير)", lat: 30.0444, lng: 31.2357, intensity: 1.0, radiusKm: 1.5 },
  { name: "Ramses Square / Station (رمسيس)", lat: 30.0626, lng: 31.2497, intensity: 0.95, radiusKm: 1.5 },
  { name: "Egyptian Museum (المتحف المصري)", lat: 30.0478, lng: 31.2336, intensity: 0.85, radiusKm: 1.2 },
  { name: "Downtown / Attaba (وسط البلد - العتبة)", lat: 30.0520, lng: 31.2460, intensity: 0.82, radiusKm: 1.5 },
  { name: "Zamalek (الزمالك)", lat: 30.0610, lng: 31.2197, intensity: 0.75, radiusKm: 1.5 },
  { name: "Giza / Pyramids (الجيزة - الأهرام)", lat: 29.9765, lng: 31.1313, intensity: 0.75, radiusKm: 2.0 },
  { name: "Heliopolis - Korba (مصر الجديدة)", lat: 30.0880, lng: 31.3250, intensity: 0.72, radiusKm: 2.0 },
  { name: "Nasr City - Abbas El-Akkad (مدينة نصر)", lat: 30.0590, lng: 31.3420, intensity: 0.70, radiusKm: 2.2 },
  { name: "Mohandessin (المهندسين)", lat: 30.0540, lng: 31.2000, intensity: 0.70, radiusKm: 1.8 },
  { name: "Maadi (المعادي)", lat: 29.9600, lng: 31.2570, intensity: 0.66, radiusKm: 2.0 },
  { name: "Cairo Airport (مطار القاهرة)", lat: 30.1219, lng: 31.4056, intensity: 0.72, radiusKm: 2.0 },
  { name: "Dokki (الدقي)", lat: 30.0385, lng: 31.2120, intensity: 0.68, radiusKm: 1.6 },
];

// POST /api/admin/seed-heatmaps — replaces tuktuk + white-taxi heatmap points.
router.post("/", requireAdmin, async (_req, res) => {
  try {
    const types = await db.select().from(transportTypesTable);
    const tuktukType = types.find((t) => t.nameEn.toLowerCase().includes("tuk"));
    const whiteTaxiType = types.find((t) => t.nameEn.toLowerCase().includes("white taxi"));

    if (!tuktukType && !whiteTaxiType) {
      return res.status(400).json({
        error: "Tuktuk and White Taxi transport types not found. Seed transport types first.",
      });
    }

    const inserted: { type: string; count: number }[] = [];

    const seedForType = async (typeId: string, typeName: string, points: HeatPoint[]) => {
      await db.delete(transportHeatmapsTable).where(eq(transportHeatmapsTable.transportTypeId, typeId));
      await db.insert(transportHeatmapsTable).values(
        points.map((p) => ({
          transportTypeId: typeId,
          latitude: p.lat,
          longitude: p.lng,
          intensity: p.intensity,
          radiusKm: p.radiusKm,
        })),
      );
      inserted.push({ type: typeName, count: points.length });
    };

    if (tuktukType) await seedForType(tuktukType.id, tuktukType.nameEn, TUKTUK_POINTS);
    if (whiteTaxiType) await seedForType(whiteTaxiType.id, whiteTaxiType.nameEn, WHITE_TAXI_POINTS);

    return res.json({ success: true, inserted });
  } catch (err) {
    console.error("seed-heatmaps error:", err);
    return res.status(500).json({ error: "Failed to seed heatmaps" });
  }
});

export default router;
