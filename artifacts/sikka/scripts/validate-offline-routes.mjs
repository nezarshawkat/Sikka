import { readFile } from "node:fs/promises";

const snapshotPath = "public/offline-snapshot.json";

function parseJson(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

function haversineKm(a, b) {
  const r = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function validatePath(path) {
  const issues = [];
  if (!Array.isArray(path) || path.length < 2) return { quality: "suspect", issues: ["missing_geometry"], maxStepMeters: 0, duplicatePoints: 0 };
  let maxStepMeters = 0;
  let duplicatePoints = 0;
  let totalKm = 0;
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const point = path[i];
    if (!Number.isFinite(point?.[0]) || !Number.isFinite(point?.[1])) issues.push("invalid_coordinate");
    const km = haversineKm(prev, point);
    if (km < 0.003) duplicatePoints++;
    totalKm += km;
    maxStepMeters = Math.max(maxStepMeters, Math.round(km * 1000));
  }
  if (maxStepMeters > 500) issues.push("long_jump");
  if (duplicatePoints > path.length * 0.25) issues.push("too_many_duplicate_points");
  if (totalKm > 0 && path.length / totalKm < 8) issues.push("low_point_density");
  const quality = issues.includes("long_jump") || issues.includes("missing_geometry")
    ? "suspect"
    : issues.length
      ? "rough"
      : path.length >= 50 ? "recorded" : "standard";
  return { quality, issues: [...new Set(issues)], maxStepMeters, duplicatePoints };
}

const snapshot = await readFile(snapshotPath, "utf8").then(parseJson);
const summary = { lines: snapshot.lines.length, suspect: 0, rough: 0, clean: 0, byIssue: {} };
const worst = [];

for (const line of snapshot.lines) {
  const result = validatePath(line.path);
  if (result.quality === "suspect") summary.suspect++;
  else if (result.quality === "rough") summary.rough++;
  else summary.clean++;
  for (const issue of result.issues) summary.byIssue[issue] = (summary.byIssue[issue] ?? 0) + 1;
  if (result.issues.length) {
    worst.push({
      id: line.id,
      lineNumber: line.lineNumber,
      name: line.nameAr || line.nameEn,
      cityZone: line.cityZone,
      maxStepMeters: result.maxStepMeters,
      issues: result.issues,
    });
  }
}

console.log(JSON.stringify({ summary, worst: worst.slice(0, 25) }, null, 2));
