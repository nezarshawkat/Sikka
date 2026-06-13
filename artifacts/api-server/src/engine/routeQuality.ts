// Route-quality model shared by the offline snapshot/delta endpoints and the
// admin route-quality dashboard. The rider planner runs entirely on-device, but
// it consumes exactly the same trust rules (mirrored in the frontend) so the
// device's scoring matches what the backend publishes.

export type DataSource = "discovery" | "gtfs" | "admin" | "csv" | "seed";
export type RouteStatus = "active" | "needs_review" | "inactive" | "pending_discovery";

// Source trust priority — higher means more trusted.
// Requested order: Discovery > GTFS > Admin > CSV/Seed.
export const SOURCE_PRIORITY: Record<DataSource, number> = {
  discovery: 4,
  gtfs: 3,
  admin: 2,
  csv: 1,
  seed: 1,
};

export function normalizeDataSource(value: unknown): DataSource {
  const v = String(value ?? "").toLowerCase();
  if (v.includes("discover")) return "discovery";
  if (v.includes("gtfs")) return "gtfs";
  if (v.includes("admin") || v.includes("manual") || v.includes("editor")) return "admin";
  if (v.includes("csv")) return "csv";
  return "seed";
}

export function sourcePriorityOf(source: DataSource): number {
  return SOURCE_PRIORITY[source] ?? 1;
}

export function normalizeRouteStatus(value: unknown): RouteStatus {
  const v = String(value ?? "").toLowerCase();
  if (v === "needs_review") return "needs_review";
  if (v === "inactive") return "inactive";
  if (v === "pending_discovery") return "pending_discovery";
  return "active";
}

// Geometry health: the biggest jump between consecutive polyline points. A large
// jump means the route may be skipping main streets (suspect geometry).
export function maxConsecutiveStepKm(path: [number, number][] | null | undefined): number {
  if (!path || path.length < 2) return 0;
  let max = 0;
  for (let i = 1; i < path.length; i++) {
    const r = 6371;
    const dLat = ((path[i][1] - path[i - 1][1]) * Math.PI) / 180;
    const dLng = ((path[i][0] - path[i - 1][0]) * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((path[i - 1][1] * Math.PI) / 180) *
        Math.cos((path[i][1] * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    max = Math.max(max, r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
  }
  return max;
}

export const PATH_SUSPECT_STEP_KM = 0.5;

export interface RouteQualityInput {
  dataSource?: unknown;
  routeStatus?: unknown;
  confidenceScore?: number | null;
  reviewReportCount?: number | null;
  verifiedAt?: Date | string | null;
  lastConfirmedAt?: Date | string | null;
  hasFixedStops?: boolean;
  lineNumber?: string | null;
  path: [number, number][] | null;
  pathPointCount?: number;
}

export interface RouteQualityMeta {
  dataSource: DataSource;
  sourcePriority: number;
  routeStatus: RouteStatus;
  confidenceScore: number; // 0..1
  pathSuspect: boolean;
  verifiedAt: string | null;
  lastConfirmedAt: string | null;
  reviewReportCount: number;
  ageDays: number; // days since last verification/confirmation
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toMillis(value: Date | string | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

// Derive a normalized, snapshot-ready quality record. Falls back to deriving a
// data source / confidence from geometry when the DB columns are absent (older
// rows) so the planner keeps working during the metadata rollout.
export function deriveRouteQuality(input: RouteQualityInput): RouteQualityMeta {
  const suspect = maxConsecutiveStepKm(input.path) > PATH_SUSPECT_STEP_KM;
  const pointCount = input.pathPointCount ?? input.path?.length ?? 0;

  let source = normalizeDataSource(input.dataSource);
  // Older rows have no explicit source: infer GTFS-grade quality from dense,
  // fixed-stop geometry; everything else stays seed-grade.
  if (!input.dataSource && (input.hasFixedStops || pointCount >= 50)) source = "gtfs";

  const status = normalizeRouteStatus(input.routeStatus);
  const reports = Math.max(0, Math.round(input.reviewReportCount ?? 0));

  const lastTouched = Math.max(toMillis(input.verifiedAt), toMillis(input.lastConfirmedAt));
  const ageDays = lastTouched > 0 ? Math.max(0, (Date.now() - lastTouched) / DAY_MS) : Infinity;

  let confidence = input.confidenceScore ?? null;
  if (confidence == null) {
    // Derive when not stored: base by source, then geometry + report penalties.
    confidence = source === "discovery" ? 0.85 : source === "gtfs" ? 0.8 : source === "admin" ? 0.72 : 0.6;
    if (suspect) confidence -= 0.25;
    if (pointCount < 10) confidence -= 0.1;
    confidence -= Math.min(0.3, reports * 0.05);
  }
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    dataSource: source,
    sourcePriority: sourcePriorityOf(source),
    routeStatus: status,
    confidenceScore: Number(confidence.toFixed(3)),
    pathSuspect: suspect,
    verifiedAt: input.verifiedAt ? new Date(toMillis(input.verifiedAt)).toISOString() : null,
    lastConfirmedAt: input.lastConfirmedAt ? new Date(toMillis(input.lastConfirmedAt)).toISOString() : null,
    reviewReportCount: reports,
    ageDays: Number.isFinite(ageDays) ? Math.round(ageDays) : -1,
  };
}

// Reports threshold: once a route accrues this many serious reports it is
// auto-flagged needs_review until an admin/AI re-snap clears it.
export const NEEDS_REVIEW_REPORT_THRESHOLD = 3;

// Report types considered "serious" enough to count toward needs_review.
export const SERIOUS_REPORT_TYPES = new Set<string>([
  "wrong_route",
  "wrong_station",
  "missing_transport",
  "closed_station",
  "wrong_instructions",
]);
