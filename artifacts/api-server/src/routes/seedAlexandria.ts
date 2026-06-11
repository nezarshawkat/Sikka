import { Router } from "express";
import { db, transportTypesTable, transitLinesTable } from "@workspace/db";
import { and, eq, like } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireAdmin } from "../middlewares/requireAdmin";
import { buildBusRoutePathAI } from "../utils/busPathEnricher";

const router = Router();

const DEFAULT_SNAPSHOT_URL =
  "https://raw.githubusercontent.com/nezarshawkat/Sikka/codex/on-device-best-snapshot/artifacts/sikka/public/offline-snapshot.json";

type LngLat = [number, number];

type SnapshotType = {
  id: string;
  nameEn: string;
  nameAr: string;
  icon: string;
  color: string;
  category?: string;
  governmentType?: string;
  averageSpeedKmh?: number;
  basePriceEgp?: number;
  pricePerKmEgp?: number;
};

type SnapshotLine = {
  id: string;
  transportTypeId: string;
  lineNumber: string | null;
  nameEn: string;
  nameAr: string;
  fromArea: string;
  toArea: string;
  governorate?: string;
  cityZone?: string;
  viaStops?: string[];
  stops?: { name: string; lat: number; lng: number }[] | null;
  path?: LngLat[] | null;
  priceEgp?: number;
  frequencyMinutes?: number | null;
  hasFixedStops?: boolean;
  routeQuality?: string;
  source?: string;
};

type OfflineSnapshot = {
  types: SnapshotType[];
  lines: SnapshotLine[];
};

type RoutePath = {
  type: "LineString";
  coordinates: LngLat[];
  source?: string;
  snapshotLineId?: string;
  routeQuality?: string;
};

function localSnapshotPaths(): string[] {
  return [
    path.resolve(process.cwd(), "artifacts/sikka/public/offline-snapshot.json"),
    path.resolve(process.cwd(), "../sikka/public/offline-snapshot.json"),
    path.resolve(process.cwd(), "../../artifacts/sikka/public/offline-snapshot.json"),
  ];
}

async function loadSnapshotFromDisk(): Promise<OfflineSnapshot | null> {
  for (const filePath of localSnapshotPaths()) {
    try {
      return JSON.parse(await readFile(filePath, "utf8")) as OfflineSnapshot;
    } catch {
      // Try the next deployment layout.
    }
  }
  return null;
}

async function loadSnapshot(snapshotUrl?: string): Promise<{ snapshot: OfflineSnapshot; source: string }> {
  const local = await loadSnapshotFromDisk();
  if (local?.lines?.length) return { snapshot: local, source: "local offline-snapshot.json" };

  const source = snapshotUrl || process.env.SIKKA_OFFLINE_SNAPSHOT_URL || DEFAULT_SNAPSHOT_URL;
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Could not load offline snapshot: ${response.status} ${response.statusText}`);
  }
  const snapshot = (await response.json()) as OfflineSnapshot;
  if (!snapshot?.lines?.length || !snapshot?.types?.length) {
    throw new Error("Offline snapshot has no transport lines or types");
  }
  return { snapshot, source };
}

function isAlexandriaLine(line: SnapshotLine): boolean {
  return line.governorate === "Alexandria"
    || line.cityZone === "alexandria"
    || line.id.startsWith("alex-")
    || line.nameEn.toLowerCase().includes("alexandria");
}

function typeDefaults(type: SnapshotType): SnapshotType {
  if (type.nameEn.toLowerCase().includes("tram")) {
    return {
      ...type,
      nameEn: "Tram",
      nameAr: type.nameAr || "Tram",
      icon: type.icon || "tram",
      color: type.color || "#16A34A",
      category: type.category || "economic",
      governmentType: type.governmentType || "government",
      averageSpeedKmh: type.averageSpeedKmh ?? 18,
      basePriceEgp: type.basePriceEgp ?? 7,
      pricePerKmEgp: type.pricePerKmEgp ?? 0,
    };
  }
  return {
    ...type,
    nameEn: "CTA Bus",
    nameAr: type.nameAr || "CTA Bus",
    icon: type.icon || "bus",
    color: type.color || "#DC2626",
    category: type.category || "economic",
    governmentType: type.governmentType || "government",
    averageSpeedKmh: type.averageSpeedKmh ?? 20,
    basePriceEgp: type.basePriceEgp ?? 13,
    pricePerKmEgp: type.pricePerKmEgp ?? 0,
  };
}

async function ensureTransportType(type: SnapshotType): Promise<string> {
  const normalized = typeDefaults(type);
  const [existing] = await db
    .select()
    .from(transportTypesTable)
    .where(eq(transportTypesTable.nameEn, normalized.nameEn))
    .limit(1);

  const values = {
    nameEn: normalized.nameEn,
    nameAr: normalized.nameAr,
    icon: normalized.icon,
    color: normalized.color,
    category: normalized.category,
    governmentType: normalized.governmentType,
    averageSpeedKmh: normalized.averageSpeedKmh,
    basePriceEgp: normalized.basePriceEgp,
    pricePerKmEgp: normalized.pricePerKmEgp,
    foreignerAllowed: true,
    isActive: true,
  };

  if (existing) {
    await db.update(transportTypesTable).set(values).where(eq(transportTypesTable.id, existing.id));
    return existing.id;
  }

  const [created] = await db.insert(transportTypesTable).values(values).returning();
  return created.id;
}

function routePathFor(line: SnapshotLine): RoutePath | null {
  if (!line.path || line.path.length < 2) return null;
  return {
    type: "LineString",
    coordinates: line.path,
    source: line.source || "bundled-city-snapshot",
    snapshotLineId: line.id,
    routeQuality: line.routeQuality,
  };
}

function haversineKm(a: LngLat, b: LngLat): number {
  const r = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function pathLengthKm(path: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineKm(path[i - 1], path[i]);
  return total;
}

function maxStepKm(path: LngLat[]): number {
  let max = 0;
  for (let i = 1; i < path.length; i++) max = Math.max(max, haversineKm(path[i - 1], path[i]));
  return max;
}

function isGoodEnhancedPath(enhanced: LngLat[], fallback: LngLat[]): boolean {
  if (enhanced.length < 2) return false;
  if (maxStepKm(enhanced) > 0.45) return false;
  const enhancedKm = pathLengthKm(enhanced);
  const fallbackKm = pathLengthKm(fallback);
  if (!Number.isFinite(enhancedKm) || enhancedKm < 0.5) return false;
  if (fallbackKm > 0 && (enhancedKm < fallbackKm * 0.35 || enhancedKm > fallbackKm * 2.75)) return false;
  return true;
}

async function bestRoutePathFor(line: SnapshotLine, enhance: boolean): Promise<{ routePath: RoutePath | null; enhanced: boolean }> {
  const fallback = routePathFor(line);
  if (!enhance || !fallback?.coordinates?.length) return { routePath: fallback, enhanced: false };

  try {
    const enriched = await buildBusRoutePathAI(
      line.fromArea,
      line.toArea,
      line.viaStops ?? [],
      "Alexandria",
    );
    const coords = enriched.routePath?.coordinates ?? [];
    if (isGoodEnhancedPath(coords, fallback.coordinates)) {
      return {
        routePath: {
          type: "LineString",
          coordinates: coords,
          source: enriched.usedAI ? "openai-mapbox-main-streets" : "mapbox-main-streets",
          snapshotLineId: line.id,
          routeQuality: "ai-snapped",
        },
        enhanced: true,
      };
    }
  } catch (err) {
    console.warn("Alexandria route enhancement failed:", line.id, err instanceof Error ? err.message : err);
  }

  return { routePath: fallback, enhanced: false };
}

router.post("/", requireAdmin, async (req, res) => {
  try {
    const enhance = req.query.enhance === "true" || req.body?.enhance === true;
    const { snapshot, source } = await loadSnapshot(
      typeof req.body?.snapshotUrl === "string" ? req.body.snapshotUrl : undefined,
    );
    const typeBySnapshotId = new Map(snapshot.types.map((type) => [type.id, type]));
    const alexLines = snapshot.lines
      .filter(isAlexandriaLine)
      .filter((line) => line.path && line.path.length >= 2);

    if (!alexLines.length) {
      return res.status(400).json({ error: "No Alexandria lines with geometry found in snapshot" });
    }

    const typeIdByName = new Map<string, string>();
    for (const type of snapshot.types) {
      const used = alexLines.some((line) => line.transportTypeId === type.id);
      if (!used) continue;
      const normalized = typeDefaults(type);
      typeIdByName.set(normalized.nameEn, await ensureTransportType(normalized));
    }

    const now = new Date();
    const deactivatedLegacy = await db
      .update(transitLinesTable)
      .set({ isActive: false, governorate: "Alexandria", updatedAt: now })
      .where(like(transitLinesTable.lineNumber, "ALEX-%"))
      .returning({ id: transitLinesTable.id });

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let enhanced = 0;
    let usedSnapshotGeometry = 0;

    for (const line of alexLines) {
      const snapshotType = typeBySnapshotId.get(line.transportTypeId);
      if (!snapshotType) {
        skipped++;
        continue;
      }
      const normalizedType = typeDefaults(snapshotType);
      const transportTypeId = typeIdByName.get(normalizedType.nameEn);
      const best = await bestRoutePathFor(line, enhance);
      const routePath = best.routePath;
      if (!transportTypeId || !routePath) {
        skipped++;
        continue;
      }
      if (best.enhanced) enhanced++;
      else usedSnapshotGeometry++;

      const lineNumber = line.lineNumber || line.id;
      const [existing] = await db
        .select()
        .from(transitLinesTable)
        .where(and(
          eq(transitLinesTable.governorate, "Alexandria"),
          eq(transitLinesTable.nameEn, line.nameEn),
          eq(transitLinesTable.lineNumber, lineNumber),
        ))
        .limit(1);

      const values = {
        transportTypeId,
        lineNumber,
        nameEn: line.nameEn,
        nameAr: line.nameAr || line.nameEn,
        fromArea: line.fromArea,
        toArea: line.toArea,
        governorate: "Alexandria",
        viaStops: line.viaStops ?? [],
        stops: line.stops ?? null,
        routePath,
        priceEgp: line.priceEgp ?? normalizedType.basePriceEgp ?? 5,
        frequencyMinutes: line.frequencyMinutes ?? null,
        hasFixedStops: line.hasFixedStops ?? normalizedType.nameEn === "Tram",
        isActive: true,
        updatedAt: now,
      };

      if (existing) {
        await db.update(transitLinesTable).set(values).where(eq(transitLinesTable.id, existing.id));
        updated++;
      } else {
        await db.insert(transitLinesTable).values(values).returning();
        inserted++;
      }
    }

    res.json({
      success: true,
      source,
      governorate: "Alexandria",
      inserted,
      updated,
      skipped,
      enhanced,
      usedSnapshotGeometry,
      deactivatedLegacy: deactivatedLegacy.length,
      totalAlexandriaLines: alexLines.length,
      message: "Alexandria CTA Bus and Tram routes are now stored in Neon and will be exported through offline snapshots.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alexandria seed error:", err);
    res.status(500).json({ error: message });
  }
});

export default router;
