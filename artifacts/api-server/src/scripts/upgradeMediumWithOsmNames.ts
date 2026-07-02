import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateRepairCandidate, type RepairAnchorInput } from "../utils/routeRepairEngine";

type Point = [number, number];

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function distanceKm(a: Point, b: Point): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const lat1 = rad(a[1]);
  const lat2 = rad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const candidatesPath = path.resolve(projectRoot, "scripts/generated/road-route-repair-candidates.json");
  const snapshotPath = path.resolve(projectRoot, "artifacts/sikka/src/data/bundledSnapshot.json");
  const namesPath = process.argv.find((argument) => argument.startsWith("--names="))?.slice(8) ??
    "C:/sikka-valhalla/routing-valhalla/egypt-name-index.json";
  const [file, snapshot, nameFile] = await Promise.all([
    readFile(candidatesPath, "utf8").then(JSON.parse),
    readFile(snapshotPath, "utf8").then(JSON.parse),
    readFile(namesPath, "utf8").then(JSON.parse),
  ]);
  const originalById = new Map(snapshot.lines.map((line: any) => [line.id, line]));
  const typeById = new Map(snapshot.types.map((type: any) => [type.id, type]));
  const medium = file.routes.filter((route: any) => route.confidenceLevel === "medium");
  let upgraded = 0;
  let matchedRoutes = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= medium.length) return;
      const route = medium[index];
      const original: any = originalById.get(route.id);
      const oldPath = original?.path as Point[] | undefined;
      if (!oldPath?.length || oldPath.length < 2) continue;
      const viaNames = Array.isArray(original.viaStops) ? original.viaStops.filter(Boolean) : [];
      const matched: Array<{ name: string; point: Point; distanceKm: number }> = [];
      for (let viaIndex = 0; viaIndex < viaNames.length; viaIndex++) {
        const name = String(viaNames[viaIndex]);
        const choices = nameFile.names[normalize(name)] as Point[] | undefined;
        if (!choices?.length) continue;
        const expectedIndex = Math.round(((viaIndex + 1) / (viaNames.length + 1)) * (oldPath.length - 1));
        const expected = oldPath[expectedIndex];
        let best = choices[0];
        let bestDistance = distanceKm(expected, best);
        for (const choice of choices.slice(1)) {
          const distance = distanceKm(expected, choice);
          if (distance < bestDistance) {
            best = choice;
            bestDistance = distance;
          }
        }
        if (bestDistance <= 12) matched.push({ name, point: best, distanceKm: bestDistance });
      }
      if (!matched.length) continue;
      matchedRoutes += 1;
      const controlPoints = [
        { name: "Route start", point: oldPath[0], confidence: 0.92, type: "start" },
        ...matched.map((item) => ({ name: item.name, point: item.point, confidence: 0.88, type: "osm_named_via" })),
        { name: "Route end", point: oldPath[oldPath.length - 1], confidence: 0.92, type: "end" },
      ].filter((item, pointIndex, array) =>
        pointIndex === 0 || distanceKm(array[pointIndex - 1].point, item.point) > 0.08,
      );
      if (controlPoints.length < 3) continue;
      const anchors: RepairAnchorInput[] = controlPoints.map((item, anchorIndex) => ({
        sequence: anchorIndex,
        name: item.name,
        lng: item.point[0],
        lat: item.point[1],
        source: "osm_named_feature",
        required: true,
        confidenceScore: item.confidence,
        anchorType: item.type,
      }));
      const line = {
        ...original,
        isActive: original.routeStatus !== "inactive",
        routePath: { type: "LineString", coordinates: oldPath },
      };
      const candidate = await generateRepairCandidate(line, typeById.get(original.transportTypeId) as any, {
        repairMode: "anchors",
        manualAnchors: anchors,
      });
      if (candidate.confidenceLevel !== "high" || !candidate.publishable) continue;

      Object.assign(route, {
        status: candidate.status,
        reason: candidate.reason ?? null,
        source: candidate.source,
        qualityScore: candidate.qualityScore,
        confidenceScore: candidate.confidenceScore,
        confidenceLevel: candidate.confidenceLevel,
        publishable: candidate.publishable,
        warnings: candidate.warnings,
        anchors: candidate.anchors,
        metrics: candidate.metrics,
        geometry: candidate.geometry,
        evidence: {
          ...candidate.evidence,
          retryStrategy: "osm_named_via",
          osmNameMatches: matched.map((item) => ({ name: item.name, distanceToExpectedKm: Number(item.distanceKm.toFixed(3)) })),
        },
      });
      upgraded += 1;
      if ((index + 1) % 25 === 0) console.log(`Checked ${index + 1}/${medium.length}; upgraded=${upgraded}`);
    }
  }

  await Promise.all(Array.from({ length: 3 }, () => worker()));
  const high = file.routes.filter((route: any) => route.confidenceLevel === "high").length;
  const remainingMedium = file.routes.length - high;
  file.stats = { total: file.routes.length, candidate: file.routes.length, confidence_high: high, publishable: high, confidence_medium: remainingMedium };
  file.osmNameUpgradeAt = new Date().toISOString();
  await writeFile(candidatesPath, `${JSON.stringify(file)}\n`, "utf8");
  console.log(JSON.stringify({ checked: medium.length, matchedRoutes, upgraded, high, medium: remainingMedium }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
