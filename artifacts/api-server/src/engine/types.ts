// Core types for the deterministic multi-modal routing engine.
// The engine NEVER invents routes — it builds a graph from verified DB data
// (transit lines, stops, station coordinates, road-snapped paths) and runs
// deterministic graph search over it.

export type Coord = { lat: number; lng: number };

// Canonical movement modes the engine reasons about.
export type ModeKey =
  | "metro"
  | "monorail"
  | "train"
  | "bus"
  | "serfis"
  | "microbus"
  | "taxi"
  | "tuktuk"
  | "walk";

export type PlanKey = "economic" | "comfortable" | "premium";

export interface TransportTypeInfo {
  id: string;
  nameEn: string;
  nameAr: string;
  icon: string;
  color: string;
  category: string; // economic | comfortable | premium
  governmentType: string; // government | private
  speedKmh: number;
  basePriceEgp: number;
  pricePerKmEgp: number;
  mode: ModeKey;
}

export interface LineStop {
  name: string; // unique node key (synthetic points use a line-private id)
  coord: Coord;
  pathIndex: number; // index into the line's route_path coordinate list
  displayName?: string; // human-readable label shown to the user
  synthetic?: boolean; // virtual board-anywhere point (not a real named stop)
}

export interface LineInfo {
  id: string;
  transportTypeId: string;
  lineNumber: string | null;
  nameEn: string;
  nameAr: string;
  fromArea: string;
  toArea: string;
  priceEgp: number;
  frequencyMinutes: number | null;
  hasFixedStops: boolean;
  // route_path coordinates as stored in DB: [lng, lat] pairs
  path: [number, number][] | null;
  stops: LineStop[]; // ordered along the line
  // true when any consecutive route_path coordinates jump > 500 m apart — a
  // signal the polyline may be corrupt / skipping main streets.
  pathSuspect?: boolean;
}

export type EdgeKind = "ride" | "board" | "alight" | "walk" | "taxi" | "tuktuk";

export interface Edge {
  to: string; // destination node id
  kind: EdgeKind;
  timeMin: number; // total minutes this edge costs (ride/wait/walk)
  costEgp: number;
  walkMin: number; // walking minutes contained in this edge (for walk limits)
  isBoarding: boolean; // true on board/taxi/tuktuk edges (counts as a transfer)
  mode: ModeKey;
  lineId?: string;
  typeId?: string;
  // for geometry reconstruction on ride edges
  fromStopIndex?: number;
  toStopIndex?: number;
}

export interface GraphNode {
  id: string;
  coord: Coord;
  kind: "stop" | "linestop" | "origin" | "dest";
  name?: string;
  lineId?: string;
  stopIndex?: number;
  typeId?: string;
}

export interface SpatialGrid {
  cell: number; // degrees per cell
  buckets: Map<string, string[]>; // cellKey -> stop node ids
}

export interface TransitGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, Edge[]>;
  types: Map<string, TransportTypeInfo>;
  lines: Map<string, LineInfo>;
  stopGrid: SpatialGrid;
  heatPoints: HeatPoint[];
  builtAt: number;
}

export interface HeatPoint {
  mode: ModeKey; // taxi | tuktuk
  coord: Coord;
  intensity: number; // 0..1
  radiusKm: number;
}

// A reconstructed leg of the journey (engine-internal, before adapting to API shape).
export interface PlanLeg {
  mode: ModeKey;
  typeId: string | null;
  lineId: string | null;
  lineNumber: string | null;
  routeDisplayName?: string;
  startName: string;
  endName: string;
  startCoord: Coord;
  endCoord: Coord;
  timeMin: number;
  waitMin: number;
  costEgp: number;
  distanceKm: number;
  geometry: [number, number][]; // [lng, lat]
  crowding: "low" | "medium" | "high";
  stopsCount?: number; // rail/bus stops ridden (for instructions)
}

export interface EnginePlan {
  legs: PlanLeg[];
  totalTimeMin: number;
  totalCostEgp: number;
  totalWalkMin: number;
  transfers: number;
  distanceKm: number;
  qualityScore: number; // 0..100
  confidence: "low" | "medium" | "high";
  plan: PlanKey;
}
