import type {
  Coord,
  Edge,
  EnginePlan,
  GraphNode,
  ModeKey,
  PlanKey,
  PlanLeg,
  TransitGraph,
  TransportTypeInfo,
} from "./types.js";
import { buildGraph, nearestStops } from "./graph.js";
import { findRoutes, type SearchOverlay, type SearchResult } from "./pathfinder.js";
import { PROFILES, directFare, walkMinutes, WALK_MAX_KM } from "./cost.js";
import { haversineKm } from "./geo.js";
import { snapConnector, snapFootOsrm, getWalkingDirections, type WalkingStep } from "../utils/routePathGenerator.js";
import { estimateCrowding } from "./crowding.js";
import { scorePlan, planConfidence } from "./score.js";
import { explainPlan } from "./explain.js";
import { validatePlan } from "./validate.js";

const TAXI_CONNECT_KM = 5;
const TUKTUK_CONNECT_KM = 3;
const ACCESS_STOP_LIMIT = 120;

function pushEdge(map: Map<string, Edge[]>, from: string, e: Edge) {
  const arr = map.get(from);
  if (arr) arr.push(e);
  else map.set(from, [e]);
}

function pickType(graph: TransitGraph, mode: ModeKey, prefer?: RegExp): TransportTypeInfo | null {
  const all = [...graph.types.values()].filter((t) => t.mode === mode);
  if (prefer) {
    const p = all.find((t) => prefer.test(t.nameEn));
    if (p) return p;
  }
  return all[0] ?? null;
}

function allowedModesForPlan(planKey: PlanKey): Set<ModeKey> {
  if (planKey === "economic") {
    return new Set(["metro", "monorail", "train", "bus", "serfis", "microbus", "tuktuk"]);
  }
  if (planKey === "comfortable") {
    // Comfortable should not use GTFS/private microbuses; it favors fixed and larger shared modes.
    return new Set(["metro", "monorail", "train", "bus", "serfis", "taxi", "tuktuk"]);
  }
  return new Set(["metro", "monorail", "train", "bus", "serfis", "taxi", "tuktuk"]);
}

function isConnectorMode(mode: ModeKey): boolean {
  return mode === "walk" || mode === "taxi" || mode === "tuktuk";
}

function connectorLabel(mode: ModeKey, graph: TransitGraph, isArabic: boolean): { id: string; name: string; color: string; icon: string } | null {
  if (mode === "walk") return { id: "walk", name: isArabic ? "مشي" : "Walk", color: "#64748B", icon: "walk" };
  const type = pickType(graph, mode, mode === "taxi" ? /taxi app|uber|careem|تطبيق|taxi/i : undefined);
  if (!type) return null;
  if (mode === "taxi") return { id: type.id, name: isArabic ? "تطبيق تاكسي" : "Taxi app", color: type.color, icon: UI_ICON[mode] };
  return { id: type.id, name: isArabic ? type.nameAr : type.nameEn, color: type.color, icon: UI_ICON[mode] };
}

function pointToSegmentKm(c: Coord, a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const cosLat = Math.cos(toRad(c.lat));
  const ax = toRad(a[0] - c.lng) * cosLat * R;
  const ay = toRad(a[1] - c.lat) * R;
  const bx = toRad(b[0] - c.lng) * cosLat * R;
  const by = toRad(b[1] - c.lat) * R;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (-ax * dx + -ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function nearPath(path: [number, number][] | null, coord: Coord, maxKm: number): boolean {
  if (!path || path.length < 2) return false;
  for (let i = 0; i < path.length - 1; i++) {
    if (pointToSegmentKm(coord, path[i], path[i + 1]) <= maxKm) return true;
  }
  return false;
}

function insideModeHeatmap(graph: TransitGraph, mode: ModeKey, coord: Coord): boolean {
  return graph.heatPoints.some((hp) =>
    hp.mode === mode && haversineKm(coord, hp.coord) <= hp.radiusKm,
  );
}

function sliceLinePath(line: { path: [number, number][] | null }, a: Coord, b: Coord): [number, number][] {
  const path = line.path;
  if (!path || path.length < 2) return [[a.lng, a.lat], [b.lng, b.lat]];
  const ia = findClosestPathIndex(path, a);
  const ib = findClosestPathIndex(path, b);
  const lo = Math.min(ia, ib);
  const hi = Math.max(ia, ib);
  const slice = path.slice(lo, hi + 1);
  const oriented = ia <= ib ? slice : slice.reverse();
  return pinGeometryEndpoints(oriented.length >= 2 ? oriented : [[a.lng, a.lat], [b.lng, b.lat]], a, b);
}

function findClosestPathIndex(path: [number, number][], coord: Coord): number {
  let minIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = haversineKm({ lng: path[i][0], lat: path[i][1] }, coord);
    if (d < minDist) {
      minDist = d;
      minIdx = i;
    }
  }
  return minIdx;
}

function pinGeometryEndpoints(geometry: [number, number][], start: Coord, end: Coord): [number, number][] {
  const pinned = geometry.length >= 2 ? geometry.map((point) => [point[0], point[1]] as [number, number]) : [];
  const startPoint: [number, number] = [start.lng, start.lat];
  const endPoint: [number, number] = [end.lng, end.lat];
  if (pinned.length < 2) return [startPoint, endPoint];
  pinned[0] = startPoint;
  pinned[pinned.length - 1] = endPoint;
  return pinned;
}

/**
 * Same governorate bounding-box rule as the client-side offline planner —
 * only suggest routes tagged to the governorate the rider is actually in.
 */
function governorateOf(point: Coord): string {
  if (point.lat >= 31.0 && point.lat <= 31.35 && point.lng >= 29.7 && point.lng <= 30.15) {
    return "Alexandria";
  }
  if (point.lat >= 29.6 && point.lat <= 30.35 && point.lng >= 30.9 && point.lng <= 31.95) {
    return "Cairo";
  }
  return "Cairo";
}

function buildOverlay(
  graph: TransitGraph,
  origin: Coord,
  dest: Coord,
  planKey: PlanKey,
): SearchOverlay {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, Edge[]>();
  nodes.set("origin", { id: "origin", coord: origin, kind: "origin" });
  nodes.set("dest", { id: "dest", coord: dest, kind: "dest" });

  const taxiType = pickType(graph, "taxi", /taxi app|uber|careem|تطبيق/i);
  const tuktukType = pickType(graph, "tuktuk");
  const useTuktukFill = planKey === "economic";

  const connect = (fromId: string, toId: string, distKm: number) => {
    if (distKm <= WALK_MAX_KM) {
      const t = walkMinutes(distKm);
      pushEdge(edges, fromId, {
        to: toId, kind: "walk", timeMin: t, costEgp: 0, walkMin: t, isBoarding: false, mode: "walk",
      });
      return;
    }
    if (useTuktukFill && tuktukType && distKm <= TUKTUK_CONNECT_KM) {
      pushEdge(edges, fromId, {
        to: toId, kind: "tuktuk", timeMin: (distKm / tuktukType.speedKmh) * 60,
        costEgp: directFare(tuktukType, distKm), walkMin: 0, isBoarding: true,
        mode: "tuktuk", typeId: tuktukType.id,
      });
    }
    if (taxiType && distKm <= TAXI_CONNECT_KM) {
      pushEdge(edges, fromId, {
        to: toId, kind: "taxi", timeMin: (distKm / taxiType.speedKmh) * 60,
        costEgp: directFare(taxiType, distKm), walkMin: 0, isBoarding: true,
        mode: "taxi", typeId: taxiType.id,
      });
    }
  };

  const originGovernorate = governorateOf(origin);
  const destGovernorate = governorateOf(dest);
  for (const s of nearestStops(graph, origin, TAXI_CONNECT_KM, ACCESS_STOP_LIMIT, originGovernorate)) {
    connect("origin", s.id, s.distKm);
  }
  for (const s of nearestStops(graph, dest, TAXI_CONNECT_KM, ACCESS_STOP_LIMIT, destGovernorate)) {
    connect(s.id, "dest", s.distKm);
  }

  const direct = haversineKm(origin, dest);
  if (direct <= WALK_MAX_KM) {
    const wt = walkMinutes(direct);
    pushEdge(edges, "origin", {
      to: "dest", kind: "walk", timeMin: wt, costEgp: 0, walkMin: wt, isBoarding: false, mode: "walk",
    });
  }

  // Door-to-door taxi-app travel is a premium-only product. Non-premium plans may
  // still use taxi as a short access connector to verified transit, but never as
  // the whole trip.
  if (taxiType && planKey === "premium") {
    pushEdge(edges, "origin", {
      to: "dest", kind: "taxi", timeMin: (direct / taxiType.speedKmh) * 60,
      costEgp: directFare(taxiType, direct), walkMin: 0, isBoarding: true, mode: "taxi", typeId: taxiType.id,
    });
  }

  return { nodes, edges };
}

// Single mode pool: every transit + connector mode competes in one search. The
// rider's tier (economic/comfortable/premium) only changes the cost weights and
// mode preferences in PROFILES — NOT which modes exist — so the rung ladder is
// gone. Per-mode admissibility (tuktuk heatmap gate, walk budget) is enforced
// inside the pathfinder; connector availability is decided in buildOverlay.
const ALL_MODES = new Set<ModeKey>([
  "metro", "monorail", "train", "bus", "serfis", "microbus", "taxi", "tuktuk",
]);

function nodeCoord(graph: TransitGraph, overlay: SearchOverlay, id: string): Coord {
  return (overlay.nodes.get(id) ?? graph.nodes.get(id))!.coord;
}

function reconstruct(
  graph: TransitGraph,
  overlay: SearchOverlay,
  res: SearchResult,
  planKey: PlanKey,
  isArabic: boolean,
): EnginePlan {
  const nameOf = (id: string): string => {
    if (id === "origin") return isArabic ? "موقعك" : "Your location";
    if (id === "dest") return isArabic ? "الوجهة" : "Destination";
    return graph.nodes.get(id)?.name ?? overlay.nodes.get(id)?.name ?? "";
  };
  const legs: PlanLeg[] = [];
  const edges = res.edges;
  const ids = res.nodeIds;
  let i = 0;

  while (i < edges.length) {
    const e = edges[i];

    if (e.kind === "walk") {
      const startId = ids[i];
      let j = i;
      let time = 0;
      while (j < edges.length && edges[j].kind === "walk") {
        time += edges[j].timeMin;
        j++;
      }
      const endId = ids[j];
      const a = nodeCoord(graph, overlay, startId);
      const b = nodeCoord(graph, overlay, endId);
      legs.push({
        mode: "walk", typeId: null, lineId: null, lineNumber: null,
        startName: nameOf(startId), endName: nameOf(endId),
        startCoord: a, endCoord: b, timeMin: time, waitMin: 0, costEgp: 0,
        distanceKm: haversineKm(a, b),
        geometry: [[a.lng, a.lat], [b.lng, b.lat]], crowding: "low",
      });
      i = j;
      continue;
    }

    if (e.kind === "taxi" || e.kind === "tuktuk") {
      const a = nodeCoord(graph, overlay, ids[i]);
      const b = nodeCoord(graph, overlay, ids[i + 1]);
      legs.push({
        mode: e.mode, typeId: e.typeId ?? null, lineId: null, lineNumber: null,
        startName: nameOf(ids[i]), endName: nameOf(ids[i + 1]),
        startCoord: a, endCoord: b, timeMin: e.timeMin, waitMin: 0, costEgp: e.costEgp,
        distanceKm: haversineKm(a, b),
        geometry: [[a.lng, a.lat], [b.lng, b.lat]],
        crowding: estimateCrowding(e.mode, a, graph.heatPoints),
      });
      i++;
      continue;
    }

    if (e.kind === "board") {
      const board = e;
      const line = board.lineId ? graph.lines.get(board.lineId) : null;
      i++;
      const rides: Edge[] = [];
      while (i < edges.length && edges[i].kind === "ride") {
        rides.push(edges[i]);
        i++;
      }
      if (i < edges.length && edges[i].kind === "alight") i++;

      if (rides.length === 0 || !line) continue;

      // Declare lastRide to prevent ReferenceError crash.
      const lastRide = rides[rides.length - 1];
      const boardLs = graph.nodes.get(board.to);
      const endLs = graph.nodes.get(lastRide.to);
      const startStop = boardLs?.stopIndex != null ? line.stops[boardLs.stopIndex] : line.stops[0];
      const endStop = endLs?.stopIndex != null ? line.stops[endLs.stopIndex] : line.stops[line.stops.length - 1];

      // Geometry slice from the high-res path. Travel direction is derived from
      // the true stop sequence (not path-index magnitude) so a line ridden
      // against its stored orientation still renders in the rider's direction.
      // The stored route_path is NEVER reshaped — only sliced and, when riding
      // in reverse, flipped — so a transport's fixed route cannot be altered.
      let geometry: [number, number][] = [];
      if (line.path && line.path.length > 0) {
        // Prefer each stop's authoritative pathIndex (set at graph build from the
        // stop's true position along route_path); only fall back to nearest-vertex
        // search when an index is missing/out of range. This avoids picking the
        // wrong arc on looped or self-near paths.
        const N = line.path.length;
        const inRange = (i: number | undefined): i is number =>
          typeof i === "number" && i >= 0 && i < N;
        const fromPathIdx = inRange(startStop.pathIndex)
          ? startStop.pathIndex
          : findClosestPathIndex(line.path, startStop.coord);
        const toPathIdx = inRange(endStop.pathIndex)
          ? endStop.pathIndex
          : findClosestPathIndex(line.path, endStop.coord);
        const lo = Math.min(fromPathIdx, toPathIdx);
        const hi = Math.max(fromPathIdx, toPathIdx);
        let slice = line.path.slice(lo, hi + 1);
        // Degenerate slice (both stops resolve to one path vertex on a coarse
        // path): widen to a 2-point window taken FROM the stored path rather than
        // synthesizing a straight line between stop coords — the leg must stay on
        // the real fixed route.
        if (slice.length < 2) {
          const a = Math.max(0, Math.min(lo, N - 2));
          slice = line.path.slice(a, a + 2);
        }
        const isForward = (boardLs?.stopIndex ?? 0) <= (endLs?.stopIndex ?? 0);
        geometry = isForward ? slice : slice.slice().reverse();
        geometry = pinGeometryEndpoints(geometry, startStop.coord, endStop.coord);
      }

      const rideTime = rides.reduce((s, r) => s + r.timeMin, 0);
      const rideCost = rides.reduce((s, r) => s + r.costEgp, 0);

      const bIdx = boardLs?.stopIndex ?? 0;
      const eIdx = endLs?.stopIndex ?? line.stops.length - 1;
      const lo = Math.min(bIdx, eIdx);
      const hi = Math.max(bIdx, eIdx);
      let distance = 0;
      for (let k = lo; k < hi; k++) {
        distance += haversineKm(line.stops[k].coord, line.stops[k + 1].coord);
      }
      if (distance <= 0) distance = haversineKm(startStop.coord, endStop.coord);

      let namedRidden = 0;
      for (let k = lo + 1; k <= hi; k++) {
        if (!line.stops[k]?.synthetic) namedRidden++;
      }

      legs.push({
        mode: board.mode, typeId: board.typeId ?? null, lineId: line.id, lineNumber: line.lineNumber,
        routeDisplayName: board.mode === "microbus" ? `${line.fromArea} → ${line.toArea}` : undefined,
        startName: startStop.displayName ?? startStop.name,
        endName: endStop.displayName ?? endStop.name,
        startCoord: startStop.coord, endCoord: endStop.coord,
        timeMin: board.timeMin + rideTime, waitMin: board.timeMin, costEgp: board.costEgp + rideCost,
        distanceKm: distance,
        geometry: geometry.length >= 2 ? geometry : [
          [startStop.coord.lng, startStop.coord.lat],
          [endStop.coord.lng, endStop.coord.lat],
        ],
        crowding: estimateCrowding(board.mode, startStop.coord, graph.heatPoints),
        stopsCount: namedRidden,
        dataSource: line.dataSource,
        routeStatus: line.routeStatus,
      });
      continue;
    }

    i++;
  }

  const cleaned = legs.filter(
    (l, idx) => !(l.mode === "walk" && l.timeMin < 1.5 && l.distanceKm < 0.12 && legs.length > 1) || idx === -1,
  );
  const finalLegs = cleaned.length ? cleaned : legs;

  const totalTimeMin = finalLegs.reduce((s, l) => s + l.timeMin, 0);
  const totalCostEgp = finalLegs.reduce((s, l) => s + l.costEgp, 0);
  const totalWalkMin = finalLegs.filter((l) => l.mode === "walk").reduce((s, l) => s + l.timeMin, 0);
  const nonWalk = finalLegs.filter((l) => l.mode !== "walk").length;
  const transfers = Math.max(0, nonWalk - 1);
  const distanceKm = finalLegs.reduce((s, l) => s + l.distanceKm, 0);

  const plan: EnginePlan = {
    legs: finalLegs, totalTimeMin, totalCostEgp, totalWalkMin, transfers, distanceKm,
    qualityScore: 0, confidence: planConfidence(finalLegs), plan: planKey,
  };
  plan.qualityScore = scorePlan(plan);
  return plan;
}

export interface PlanRequest {
  origin: Coord;
  dest: Coord;
  planKey: PlanKey;
  isArabic: boolean;
  language?: string;
}

const UI_ICON: Record<ModeKey, string> = {
  metro: "metro", monorail: "monorail", lrt: "lrt", brt: "brt", train: "train",
  bus: "bus", serfis: "bus", microbus: "bus",
  taxi: "car", tuktuk: "bike", walk: "walk",
};

type PlannerLanguage = "en" | "ar" | "fr" | "de" | "es" | "zh" | "ru";

function plannerLanguage(value: boolean | string): PlannerLanguage {
  if (typeof value === "boolean") return value ? "ar" : "en";
  return value === "ar" || value === "fr" || value === "de" || value === "es" || value === "zh" || value === "ru"
    ? value
    : "en";
}

const modeNames: Record<Exclude<PlannerLanguage, "en" | "ar">, Record<ModeKey, string>> = {
  fr: { metro: "metro", monorail: "monorail", lrt: "RER leger", brt: "BRT", train: "train", bus: "bus", serfis: "serfis", microbus: "minibus", taxi: "taxi", tuktuk: "tuk-tuk", walk: "marche" },
  de: { metro: "Metro", monorail: "Monorail", lrt: "Stadtbahn", brt: "Schnellbus", train: "Zug", bus: "Bus", serfis: "Serfis", microbus: "Minibus", taxi: "Taxi", tuktuk: "Tuk-tuk", walk: "Fussweg" },
  es: { metro: "metro", monorail: "monorriel", lrt: "tren ligero", brt: "autobus rapido", train: "tren", bus: "autobus", serfis: "serfis", microbus: "microbus", taxi: "taxi", tuktuk: "tuk-tuk", walk: "caminar" },
  zh: { metro: "地铁", monorail: "单轨", lrt: "轻轨", brt: "快速公交", train: "火车", bus: "公交车", serfis: "合乘车", microbus: "小巴", taxi: "出租车", tuktuk: "嘟嘟车", walk: "步行" },
  ru: { metro: "метро", monorail: "монорельс", lrt: "легкое метро", brt: "скоростной автобус", train: "поезд", bus: "автобус", serfis: "серфис", microbus: "маршрутка", taxi: "такси", tuktuk: "тук-тук", walk: "пешком" },
};

function localizedCrowd(crowding: PlanLeg["crowding"], lang: Exclude<PlannerLanguage, "en" | "ar">): string {
  const labels = {
    fr: { low: "faible affluence", medium: "affluence moyenne", high: "forte affluence" },
    de: { low: "geringe Auslastung", medium: "mittlere Auslastung", high: "hohe Auslastung" },
    es: { low: "poca ocupacion", medium: "ocupacion media", high: "mucha ocupacion" },
    zh: { low: "低拥挤度", medium: "中等拥挤度", high: "高拥挤度" },
    ru: { low: "мало людей", medium: "средняя загруженность", high: "много людей" },
  } as const;
  return labels[lang][crowding];
}

function localizedStopText(stops: number, km: number, lang: Exclude<PlannerLanguage, "en" | "ar">): string {
  if (lang === "fr") return stops > 0 ? `Comptez environ ${stops} arret(s)` : `Restez sur la ligne environ ${km} km`;
  if (lang === "de") return stops > 0 ? `Zaehlen Sie etwa ${stops} Haltestelle(n)` : `Bleiben Sie etwa ${km} km auf der Linie`;
  if (lang === "es") return stops > 0 ? `Cuenta unas ${stops} parada(s)` : `Permanece en la linea unos ${km} km`;
  if (lang === "zh") return stops > 0 ? `大约经过 ${stops} 站` : `沿线路乘坐约 ${km} 公里`;
  return stops > 0 ? `Считайте примерно ${stops} остановок` : `Оставайтесь на линии около ${km} км`;
}

function localizedLegInstructions(leg: PlanLeg, type: TransportTypeInfo | null, language: PlannerLanguage): string[] | null {
  if (language === "en" || language === "ar") return null;
  const name = modeNames[language][type?.mode ?? leg.mode];
  const cost = Math.round(leg.costEgp);
  const mins = Math.max(1, Math.round(leg.timeMin));
  const km = Math.max(0.1, Math.round(leg.distanceKm * 10) / 10);
  const stops = leg.stopsCount ?? 0;
  const stopText = localizedStopText(stops, km, language);
  const crowd = localizedCrowd(leg.crowding, language);
  const start = leg.startName || "your location";
  const end = leg.endName || "your destination";

  if (leg.mode === "walk") {
    if (language === "fr") return [`Commencez a ${start}.`, `Marchez par le chemin disponible le plus court environ ${km} km (${mins} min).`, `Arrivez a ${end} avant de prendre le prochain trajet.`];
    if (language === "de") return [`Starten Sie bei ${start}.`, `Gehen Sie den kuerzesten verfuegbaren Weg etwa ${km} km (${mins} Min).`, `Kommen Sie bei ${end} an, bevor Sie den naechsten Abschnitt nehmen.`];
    if (language === "es") return [`Empieza en ${start}.`, `Camina por la ruta disponible mas corta unos ${km} km (${mins} min).`, `Llega a ${end} antes de subir al siguiente tramo.`];
    if (language === "zh") return [`从 ${start} 开始。`, `沿最短可用路线步行约 ${km} 公里（${mins} 分钟）。`, `到达 ${end} 后再进入下一段。`];
    return [`Начните в ${start}.`, `Идите кратчайшим доступным путем около ${km} км (${mins} мин).`, `Дойдите до ${end} перед следующим участком.`];
  }

  if (leg.mode === "taxi" || leg.mode === "tuktuk") {
    if (language === "fr") return [`De ${start} a ${end}.`];
    if (language === "de") return [`Von ${start} nach ${end}.`];
    if (language === "es") return [`De ${start} a ${end}.`];
    if (language === "zh") return [`从 ${start} 到 ${end}。`];
    return [`От ${start} до ${end}.`];
  }

  const ln = leg.lineNumber ? ` ${leg.lineNumber}` : "";
  const confirm = leg.lineNumber ? " " : "";
  const isStreetBus = leg.mode === "bus" || leg.mode === "microbus" || leg.mode === "serfis";
  if (language === "fr") {
    return [
      `Allez au point d embarquement : ${start}.`,
      `Montez dans ${name}${ln}${confirm && leg.lineNumber ? "(confirmez le numero ou le panneau avant de monter)" : ""}.`,
      ...(isStreetBus ? [`Demandez s il va a ${end}.`] : []),
      `Payez environ ${cost} EGP en montant ou selon la demande de l operateur.`,
      `${stopText}, en surveillant la direction vers ${end}.`,
      `Descendez a ${end}. Condition prevue : ${crowd}.`,
    ];
  }
  if (language === "de") {
    return [
      `Gehen Sie zum Einstiegspunkt: ${start}.`,
      `Steigen Sie in ${name}${ln}${confirm && leg.lineNumber ? " (Nummer/Schild vor dem Einsteigen bestaetigen)" : ""}.`,
      ...(isStreetBus ? [`Fragen Sie, ob es nach ${end} faehrt.`] : []),
      `Zahlen Sie beim Einsteigen etwa ${cost} EGP oder wie der Betreiber verlangt.`,
      `${stopText} und achten Sie auf die Richtung nach ${end}.`,
      `Steigen Sie bei ${end} aus. Erwartete Lage: ${crowd}.`,
    ];
  }
  if (language === "es") {
    return [
      `Ve al punto de subida: ${start}.`,
      `Sube a ${name}${ln}${confirm && leg.lineNumber ? " (confirma el numero o letrero antes de subir)" : ""}.`,
      ...(isStreetBus ? [`Pregunta si va a ${end}.`] : []),
      `Paga unos ${cost} EGP al subir o segun indique el operador.`,
      `${stopText}, mirando la direccion hacia ${end}.`,
      `Baja en ${end}. Condicion esperada: ${crowd}.`,
    ];
  }
  if (language === "zh") {
    return [
      `前往上车点：${start}。`,
      `乘坐 ${name}${ln}${confirm && leg.lineNumber ? "（上车前确认编号或标牌）" : ""}。`,
      ...(isStreetBus ? [`询问是否开往 ${end}。`] : []),
      `上车时支付约 ${cost} EGP，或按运营方要求支付。`,
      `${stopText}，注意前往 ${end} 的方向。`,
      `在 ${end} 下车。预计情况：${crowd}。`,
    ];
  }
  return [
    `Идите к месту посадки: ${start}.`,
    `Садитесь на ${name}${ln}${confirm && leg.lineNumber ? " (проверьте номер или табличку перед посадкой)" : ""}.`,
    ...(isStreetBus ? [`Спросите, идет ли он до ${end}.`] : []),
    `Заплатите около ${cost} EGP при посадке или как попросит оператор.`,
    `${stopText}, следите за направлением к ${end}.`,
    `Выйдите на ${end}. Ожидаемое состояние: ${crowd}.`,
  ];
}

function legInstructions(leg: PlanLeg, type: TransportTypeInfo | null, languageOrArabic: boolean | string): string[] {
  const language = plannerLanguage(languageOrArabic);
  const localized = localizedLegInstructions(leg, type, language);
  if (localized) return localized;
  const isArabic = language === "ar";
  const name = type ? (isArabic ? type.nameAr : type.nameEn) : isArabic ? "مشي" : "Walk";
  const cost = Math.round(leg.costEgp);
  const km = Math.max(0.1, Math.round(leg.distanceKm * 10) / 10);
  const start = leg.startName || (isArabic ? "موقعك" : "your location");
  const end = leg.endName || (isArabic ? "النقطة التالية" : "the next point");
  const ln = leg.lineNumber ? ` ${leg.lineNumber}` : "";
  const stops = leg.stopsCount ?? 0;

  // Typical wait before the next vehicle shows up — half the headway, the
  // expected wait for a rider arriving at a random time. Only meaningful for
  // shared transit modes, not personal/on-demand rides (taxi/tuktuk) or walks.
  const wait = Math.round(leg.waitMin ?? 0);
  const waitLine = wait > 0
    ? [isArabic ? `المتوقع: ${name}${ln} جاي كل حوالي ${wait} دقيقة.` : `Expect the next ${name}${ln} in about ${wait} min.`]
    : [];

  // ── Walking (fallback text — real turn-by-turn is used when OSRM is reachable) ──
  if (leg.mode === "walk") {
    return isArabic
      ? [
          `ابدأ من ${start}.`,
          `امشِ أقصر مسار متاح حوالي ${km} كم.`,
          `اتجه إلى ${end} وتأكد أنك وصلت قبل ركوب الوسيلة التالية.`,
        ]
      : [
          `Start at ${start}.`,
          `Walk the shortest available path for about ${km} km.`,
          `Arrive at ${end} before boarding the next leg.`,
        ];
  }

  // ── Tuktuk: no meter, agree the fare first ──
  if (leg.mode === "tuktuk") {
    return isArabic
      ? [
          `دوّر على توك توك قريب من ${start} — بيقفوا في مجموعات على الناصية غالباً.`,
          `اتفق على السعر قبل ما تركب، وحوالي ${cost} جنيه — التوك توك مالوش عداد.`,
          `قول وجهتك بوضوح: ${end}.`,
          `ادفع زي ما اتفقتوا، وانزل من الجنب البعيد عن السيارات.`,
        ]
      : [
          `Find a tuktuk near ${start} — they often wait in clusters at a corner.`,
          `Agree on the fare before you get in, about ${cost} EGP — tuktuks don't have a meter.`,
          `Tell the driver your destination clearly: ${end}.`,
          `Pay as agreed, and get out on the side away from traffic.`,
        ];
  }

  // ── Taxi (street taxi or app-based) ──
  if (leg.mode === "taxi") {
    return isArabic
      ? [
          `لو من خلال تطبيق: اطلب الرحلة من ${start} إلى ${end} وتأكد من اسم السائق ولوحة العربية قبل الركوب.`,
          `لو تاكسي عادي في الشارع: اتفق على السعر قبل الركوب (حوالي ${cost} جنيه) لأنه غالباً بدون عداد.`,
          `ادفع من خلال التطبيق، أو نقدي في الآخر لو تاكسي شارع.`,
        ]
      : [
          `If using an app: request the ride from ${start} to ${end}, and check the driver's name and plate match before getting in.`,
          `If it's a street taxi: agree the fare before the ride starts (about ${cost} EGP) — most don't run a meter.`,
          `Pay through the app, or in cash at the end for a street taxi.`,
        ];
  }

  // ── Metro / Monorail / Train: gated stations, fixed stops, clear signage ──
  if (leg.mode === "metro" || leg.mode === "monorail" || leg.mode === "train" || leg.mode === "lrt") {
    const womenNote = leg.mode === "metro" || leg.mode === "lrt";
    return [...waitLine, ...(isArabic
      ? [
          `روح لمحطة ${start} واشتري تذكرة أو اعمل تاب بالكارت عند الجيت.`,
          ...(womenNote ? [`العربيتين في النص مخصصتين للسيدات فقط — لو محتاج تعرف.`] : []),
          `اركب ${name}${ln} في اتجاه ${end}، وتابع لون الخط على لوحات الرصيف.`,
          stops > 0 ? `عدّ حوالي ${stops} محطة — أسماء المحطات بتُعلن وبتظهر على الشاشة جوه العربية.` : `تابع الخط حتى محطة ${end}.`,
          `انزل في محطة ${end} واتبع لافتة الخروج باسم الشارع/المعلم اللي يناسب وجهتك — لمحطات المترو أكتر من باب خروج بيوصل لشوارع مختلفة تماماً.`,
        ]
      : [
          `Head to ${start} station and buy a ticket, or tap your card at the gate.`,
          ...(womenNote ? [`The middle two cars are reserved for women only, in case that matters for you.`] : []),
          `Board ${name}${ln} toward ${end}, and follow the line's color on the platform signage.`,
          stops > 0 ? `Count about ${stops} stop${stops === 1 ? "" : "s"} — station names are announced and shown on screens inside the car.` : `Stay on the line until ${end}.`,
          `Exit at ${end} station and follow the exit sign for the street or landmark you need — metro stations often have several numbered exits leading to very different streets.`,
        ])];
  }

  if (leg.mode === "brt") {
    return [...waitLine, ...(isArabic
      ? [
          `روح لمحطة الباص الترددي عند ${start} — الوصول غالباً من خلال كوبري أو نفق مشاة فوق الطريق الدائري.`,
          `اعمل تاب بالكارت أو اشتري تذكرة عند البوابة الإلكترونية، زي محطات المترو.`,
          `اركب الباص في اتجاه ${end} وتابع الشاشات اللي بتوضح وقت وصول الباص التالي.`,
          `انزل في محطة ${end} واتبع لافتات الخروج.`,
        ]
      : [
          `Head to the BRT station at ${start} — access is usually via a pedestrian bridge or tunnel above the Ring Road.`,
          `Tap your card or buy a ticket at the electronic gate, similar to a metro station.`,
          `Board the bus toward ${end} and watch the screens for the next bus's arrival time.`,
          `Get off at ${end} station and follow the exit signage.`,
        ])];
  }

  // ── Microbus: informal, no signage, no fixed stops ──
  if (leg.mode === "microbus") {
    return [...waitLine, ...(isArabic
      ? [
          `امشِ لحد ${start} وقف على جنب الطريق في اتجاه السيارات الجاية، علشان تقدر تلوّح بسهولة.`,
          `لوّح بإيدك لأي ميكروباص رايح في اتجاهك — مش هيقف لوحده، ولازم تلوّح بوضوح.`,
          `وانت داخل قول وجهتك بصوت عالي زي "${end}!" — أغلب الميكروباصات مالها لافتة خط واضحة.`,
          `مرّر الأجرة لقدام إيد بإيد لحد ما توصل للسواق، وحوالي ${cost} جنيه. الباقي بيرجع بنفس الطريقة.`,
          `لما تقرب من ${end} قول "على الطلب" أو "هنا كويس" قبل ما توصل بشوية — الميكروباص بينزّل في أي حتة، مش في محطات بس.`,
          `انزل من الجنب البعيد عن السيارات، وخد بالك من الموتوسيكلات قبل ما تفتح الباب.`,
        ]
      : [
          `Walk to ${start} and stand at the edge of the road facing oncoming traffic, so you can flag one down easily.`,
          `Flag down any microbus heading your way — it won't stop on its own, so wave clearly.`,
          `As you get in, call out your destination loudly, e.g. "${end}!" — most microbuses have no route signage.`,
          `Pass your fare forward hand-to-hand until it reaches the driver, about ${cost} EGP. Change comes back the same way.`,
          `When you're near ${end}, say "ala el talab" (on request) or just ask to stop a few seconds before — microbuses stop anywhere on request, not just at fixed points.`,
          `Get out on the side away from traffic, and check for motorcycles passing close before opening the door.`,
        ])];
  }

  // ── Serfis: similar etiquette to microbus, often has an informal stand at each end ──
  if (leg.mode === "serfis") {
    return [...waitLine, ...(isArabic
      ? [
          `روح لـ ${start} — غالباً فيه مكان معروف بتقف فيه السرفيسات أو بتعدي منه.`,
          `لوّح لسرفيس رايح ناحية ${end}، أو اسأل أي حد واقف هناك يدّلك على الصحيح.`,
          `أكّد وجهتك وانت داخل — السواق بينده على الخط، بس اتأكد لو مش متابع.`,
          `ادفع حوالي ${cost} جنيه جوه العربية، بتمريرها لقدام زي الميكروباص.`,
          `قول "على الطلب" وانت قرب من ${end}.`,
          `انزل بحذر من جنب الرصيف.`,
        ]
      : [
          `Head to ${start} — usually a known stand or corner where serfis line up or pass by.`,
          `Flag one down heading toward ${end}, or ask someone waiting there which one to take.`,
          `Confirm your destination as you board — drivers usually call out the route, but double-check if unsure.`,
          `Pay about ${cost} EGP onboard, passed forward like in a microbus.`,
          `Ask to stop ("ala el talab") as you near ${end}.`,
          `Get off carefully on the curb side.`,
        ])];
  }

  // ── CTA / NTA city bus: marked stops, route boards, more fixed than microbus ──
  const stopText = isArabic
    ? stops > 0 ? `عدّ ${stops} محطة تقريباً` : `تابع الخط حوالي ${km} كم`
    : stops > 0 ? `Count about ${stops} stop${stops === 1 ? "" : "s"}` : `Stay on for about ${km} km`;
  return [...waitLine, ...(isArabic
    ? [
        `روح لمحطة الأتوبيس المعلّمة عند ${start} — الأتوبيسات الرسمية بتقف في محطات معلّمة بس، مش في أي حتة.`,
        `قبل ما تركب، بص على لوحة رقم الخط/الوجهة في الزجاج الأمامي وتأكد إنه رايح ${end}.`,
        `اركب ${name}${ln} وادفع جوه (نقدي للكمساري أو تاب بالكارت)، وحوالي ${cost} جنيه.`,
        `يفضل تتأكد مع الكمساري أو أي راكب إن الأتوبيس ده بيقف قريب من ${end}، لأن مش كل المحطات بتُعلن.`,
        `${stopText}، وراقب الاتجاه نحو ${end}.`,
        `انزل عند ${end} وخد بالك من الزحمة وانت بتنزل.`,
      ]
    : [
        `Go to the marked bus stop at ${start} — official buses only stop at signed stops, not on request.`,
        `Before boarding, check the route number/destination board in the windshield to confirm it's heading to ${end}.`,
        `Board ${name}${ln} and pay onboard (cash to the conductor, or tap your card), about ${cost} EGP.`,
        `It's still worth confirming with the conductor or a fellow rider that this bus stops near ${end}, since not every stop is announced.`,
        `${stopText}, watching for the direction toward ${end}.`,
        `Get off at ${end}, watching for other traffic as you step down.`,
      ])];
}

// Straight-line fallback for a connector whose snap failed: a few linearly
// interpolated points between the leg's OWN endpoints. Never routes through a
// fixed city centroid (which would warp cross-city legs across Cairo).
function interpolateLine(a: Coord, b: Coord, n = 5): number[][] {
  const pts: number[][] = [];
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0 : k / (n - 1);
    pts.push([a.lng + (b.lng - a.lng) * t, a.lat + (b.lat - a.lat) * t]);
  }
  return pts;
}

// Snap connector legs to the street network; pin start/end after snapping so the
// polyline anchors exactly at the logical endpoints. On failure, fall back to a
// localized interpolated straight line (not the stored 2-point straight line).
async function onStreetGeometry(leg: PlanLeg): Promise<number[][]> {
  if (leg.mode === "walk" || leg.mode === "taxi" || leg.mode === "tuktuk") {
    const a: [number, number] = [leg.startCoord.lng, leg.startCoord.lat];
    const b: [number, number] = [leg.endCoord.lng, leg.endCoord.lat];
    try {
      // Walk legs follow the pedestrian network (OSRM foot); taxi/tuktuk legs use
      // the driving network (OSRM). For walking, prefer OSRM foot and fall back
      // to the walking routing service so a transient OSRM failure still yields snapped geometry.
      let snapped: [number, number][] | null = null;
      if (leg.mode === "walk") {
        snapped = await snapFootOsrm(a, b);
        if (!snapped || snapped.length < 2) snapped = await snapConnector("walking", a, b);
      } else {
        snapped = await snapConnector("driving", a, b);
      }
      if (snapped && snapped.length >= 2) {
        // Clone before pinning so we never mutate an array still held in the
        // snap helpers' coord caches.
        const out = snapped.map((p) => [p[0], p[1]] as [number, number]);
        out[0] = a;
        out[out.length - 1] = b;
        return out;
      }
    } catch (e) {
      console.error("Connector snapped geometry lookup failed", e);
    }
    return interpolateLine(leg.startCoord, leg.endCoord);
  }
  return leg.geometry;
}

// Cap the number of spoken-out turns so a long walk doesn't read like a wall of
// text; group anything past the cap into one closing line instead of dropping it.
const MAX_WALK_STEPS = 6;

function formatWalkSteps(steps: WalkingStep[], leg: PlanLeg, isArabic: boolean): string[] {
  const real = steps.filter((s) => s.distanceMeters > 0 || steps.indexOf(s) === 0);
  const shown = real.slice(0, MAX_WALK_STEPS);
  const lines = shown.map((s) => {
    const meters = s.distanceMeters;
    const dist = meters >= 1000
      ? `${(meters / 1000).toFixed(1)} km`
      : meters > 15 ? `${meters} m` : "";
    return isArabic
      ? `${s.instruction}${dist ? ` (${dist})` : ""}`
      : `${s.instruction}${dist ? ` (${dist})` : ""}`;
  });
  if (real.length > MAX_WALK_STEPS) {
    lines.push(isArabic
      ? `تابع حسب الخريطة لحد ${leg.endName || "النقطة التالية"}.`
      : `Keep following the map the rest of the way to ${leg.endName || "the next point"}.`);
  }
  return lines;
}

/**
 * Walk legs get REAL turn-by-turn from OSRM (free) when reachable, instead of
 * a generic "walk about X km" line. Falls back to the existing distance-based
 * instructions and snapped/interpolated geometry if OSRM can't be reached —
 * the rider is never left with no guidance at all.
 */
async function walkLegDetails(
  leg: PlanLeg,
  type: TransportTypeInfo | null,
  languageOrArabic: boolean | string,
): Promise<{ geometry: number[][]; instructions: string[] }> {
  const language = plannerLanguage(languageOrArabic);
  if (leg.mode !== "walk") {
    return { geometry: await onStreetGeometry(leg), instructions: legInstructions(leg, type, language) };
  }

  const a: [number, number] = [leg.startCoord.lng, leg.startCoord.lat];
  const b: [number, number] = [leg.endCoord.lng, leg.endCoord.lat];
  try {
    const directions = await getWalkingDirections(a, b);
    if (directions?.steps.length) {
      const geometry = directions.geometry.map((p) => [p[0], p[1]] as [number, number]);
      geometry[0] = a;
      geometry[geometry.length - 1] = b;
      const isArabic = language === "ar";
      const stepLines = (language === "en" || language === "ar")
        ? formatWalkSteps(directions.steps, leg, isArabic)
        : [];
      if (stepLines.length) {
        return { geometry, instructions: stepLines };
      }
    }
  } catch (e) {
    console.error("Walking directions lookup failed", e);
  }
  return { geometry: await onStreetGeometry(leg), instructions: legInstructions(leg, type, language) };
}

const STITCH_CONNECTOR_MODES = new Set<ModeKey>(["walk", "taxi", "tuktuk"]);

// Eliminate visual cuts between consecutive segment polylines WITHOUT ever
// altering a fixed transit route. Only flexible connector legs (walk/taxi/tuktuk)
// are reshaped: a connector endpoint is moved to meet the adjacent transit
// polyline, and the journey's very first/last point is pinned to the true
// origin/destination ONLY when that boundary leg is itself a connector. Two
// adjacent transit polylines are NEVER snapped — moving a transit vertex would
// change a fixed route — so a real transit↔transit gap is left intact and
// rejected by validatePlan (geometry_cut) instead of being papered over.
function stitchSegmentGeometry(
  segments: { route_geometry: number[][] }[],
  legs: PlanLeg[],
): void {
  if (segments.length && legs.length) {
    const first = segments[0].route_geometry;
    if (first?.length && STITCH_CONNECTOR_MODES.has(legs[0].mode)) {
      first[0] = [legs[0].startCoord.lng, legs[0].startCoord.lat];
    }
    const last = segments[segments.length - 1].route_geometry;
    const lastLeg = legs[legs.length - 1];
    if (last?.length && STITCH_CONNECTOR_MODES.has(lastLeg.mode)) {
      last[last.length - 1] = [lastLeg.endCoord.lng, lastLeg.endCoord.lat];
    }
  }
  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i].route_geometry;
    const b = segments[i + 1].route_geometry;
    if (!a?.length || !b?.length) continue;
    const aEnd = a[a.length - 1];
    const bStart = b[0];
    const aConn = STITCH_CONNECTOR_MODES.has(legs[i].mode);
    const bConn = STITCH_CONNECTOR_MODES.has(legs[i + 1].mode);
    // Move only the connector side(s). Transit↔transit (neither connector) is
    // left untouched on purpose.
    if (aConn && !bConn) {
      a[a.length - 1] = [bStart[0], bStart[1]];
    } else if (!aConn && bConn) {
      b[0] = [aEnd[0], aEnd[1]];
    } else if (aConn && bConn) {
      b[0] = [aEnd[0], aEnd[1]];
    }
  }
}


interface ApiAlternative {
  transport_type_id: string;
  transport_name: string;
  cost_egp: number;
  duration_minutes: number;
  color: string;
  icon: string;
  line_id?: string | null;
  line_number?: string | null;
  info?: string;
  instructions?: string[];
  route_geometry?: number[][];
}

async function buildConnectorAlternative(
  graph: TransitGraph,
  leg: PlanLeg,
  mode: ModeKey,
  languageOrArabic: boolean | string,
): Promise<ApiAlternative | null> {
  const language = plannerLanguage(languageOrArabic);
  const isArabic = language === "ar";
  if (!isConnectorMode(mode) || mode === leg.mode) return null;
  if (mode === "walk" && leg.distanceKm > WALK_MAX_KM) return null;
  if (mode === "tuktuk" && (!insideModeHeatmap(graph, "tuktuk", leg.startCoord) || !insideModeHeatmap(graph, "tuktuk", leg.endCoord))) return null;
  const label = connectorLabel(mode, graph, isArabic);
  if (!label) return null;
  const type = mode === "walk" ? null : pickType(graph, mode, mode === "taxi" ? /taxi app|uber|careem|تطبيق|taxi/i : undefined);
  const speed = mode === "walk" ? 4.5 : type?.speedKmh ?? 25;
  const cost = mode === "walk" ? 0 : directFare(type!, leg.distanceKm);
  const altLeg: PlanLeg = { ...leg, mode, typeId: type?.id ?? null, lineId: null, lineNumber: null, costEgp: cost, timeMin: (leg.distanceKm / speed) * 60 };
  const { geometry, instructions } = await walkLegDetails(altLeg, type, language);
  return {
    transport_type_id: label.id,
    transport_name: label.name,
    cost_egp: Math.round(cost),
    duration_minutes: Math.max(1, Math.round(altLeg.timeMin)),
    color: label.color,
    icon: label.icon,
    line_id: null,
    line_number: null,
    info: `${Math.round(leg.distanceKm * 10) / 10} km`,
    instructions,
    route_geometry: geometry,
  };
}

async function buildAlternatives(graph: TransitGraph, leg: PlanLeg, planKey: PlanKey, languageOrArabic: boolean | string): Promise<ApiAlternative[]> {
  const language = plannerLanguage(languageOrArabic);
  const isArabic = language === "ar";
  const alternatives: ApiAlternative[] = [];
  const seen = new Set<string>([`${leg.mode}:${leg.lineId ?? leg.typeId ?? ""}`]);
  const push = (alt: ApiAlternative | null) => {
    if (!alt) return;
    const key = `${alt.transport_type_id}:${alt.line_id ?? alt.line_number ?? alt.transport_name}`;
    if (seen.has(key)) return;
    seen.add(key);
    alternatives.push(alt);
  };

  // Always expose flexible connector swaps when physically reasonable. This is the
  // review-screen switcher: choosing one updates the stored trip and home-map drawing.
  if (leg.distanceKm <= WALK_MAX_KM) push(await buildConnectorAlternative(graph, leg, "walk", language));
  if (planKey !== "economic" || leg.mode === "taxi") push(await buildConnectorAlternative(graph, leg, "taxi", language));
  if (planKey === "economic" && leg.distanceKm <= TUKTUK_CONNECT_KM) push(await buildConnectorAlternative(graph, leg, "tuktuk", language));

  // For transit legs, offer nearby real lines that serve the same corridor. Prefer
  // non-suspect/high-resolution paths first (GTFS imports usually have dense, clean geometry).
  if (!isConnectorMode(leg.mode)) {
    const allowed = allowedModesForPlan(planKey);
    const candidates = [...graph.lines.values()]
      .filter((line) => line.id !== leg.lineId)
      .filter((line) => {
        const type = graph.types.get(line.transportTypeId);
        return !!type && allowed.has(type.mode) && nearPath(line.path, leg.startCoord, 0.65) && nearPath(line.path, leg.endCoord, 0.65);
      })
      .sort((a, b) => Number(a.pathSuspect) - Number(b.pathSuspect) || (b.path?.length ?? 0) - (a.path?.length ?? 0))
      .slice(0, 4);

    for (const line of candidates) {
      const type = graph.types.get(line.transportTypeId)!;
      const geom = sliceLinePath(line, leg.startCoord, leg.endCoord);
      const dist = Math.max(0.1, leg.distanceKm);
      const transportName = type.mode === "microbus"
        ? `${line.fromArea} → ${line.toArea}`
        : `${isArabic ? type.nameAr : type.nameEn}${line.lineNumber ? ` ${line.lineNumber}` : ""}`;
      const altLeg: PlanLeg = {
        ...leg,
        mode: type.mode,
        typeId: type.id,
        lineId: line.id,
        lineNumber: line.lineNumber,
        timeMin: Math.max(1, (dist / Math.max(8, type.speedKmh)) * 60 + (line.frequencyMinutes ?? 12) / 2),
        costEgp: directFare(type, dist),
        geometry: geom as [number, number][],
        stopsCount: undefined,
        dataSource: line.dataSource,
        routeStatus: line.routeStatus,
      };
      push({
        transport_type_id: type.id,
        transport_name: transportName,
        cost_egp: Math.round(altLeg.costEgp),
        duration_minutes: Math.max(1, Math.round(altLeg.timeMin)),
        color: type.color,
        icon: UI_ICON[type.mode],
        line_id: line.id,
        line_number: line.lineNumber,
        info: `${Math.round(dist * 10) / 10} km · ${line.pathSuspect ? "community route" : "high-confidence route"}`,
        instructions: legInstructions(altLeg, type, language),
        route_geometry: geom,
      });
    }
  }

  return alternatives.slice(0, 6);
}

export async function adaptPlanToApi(graph: TransitGraph, plan: EnginePlan, languageOrArabic: boolean | string) {
  const language = plannerLanguage(languageOrArabic);
  const isArabic = language === "ar";
  const segments = await Promise.all(plan.legs.map(async (leg) => {
    const type = leg.typeId ? graph.types.get(leg.typeId) ?? null : null;
    const name = leg.mode === "microbus" && leg.routeDisplayName
      ? leg.routeDisplayName
      : type
        ? `${isArabic ? type.nameAr : type.nameEn}${leg.lineNumber ? ` ${leg.lineNumber}` : ""}`
        : isArabic ? "مشي" : "Walk";
    const alternatives = await buildAlternatives(graph, leg, plan.plan, language);
    const { geometry, instructions } = await walkLegDetails(leg, type, language);
    return {
      transport_type_id: leg.typeId ?? leg.mode,
      transport_name: name,
      government_type: type?.governmentType ?? "private",
      category: type?.category ?? "economic",
      start_name: leg.startName, end_name: leg.endName,
      cost_egp: Math.round(leg.costEgp), duration_minutes: Math.max(1, Math.round(leg.timeMin)),
      color: type?.color ?? "#64748B", icon: UI_ICON[leg.mode],
      line_id: leg.lineId, line_number: leg.lineNumber,
      info: `${Math.round(leg.distanceKm * 10) / 10} km · ${leg.crowding} crowding`,
      instructions,
      route_geometry: geometry,
      crowding: leg.crowding, alternatives,
    };
  }));

  stitchSegmentGeometry(segments, plan.legs);

  return {
    segments, total_cost_egp: Math.round(plan.totalCostEgp),
    total_duration_minutes: Math.max(1, Math.round(plan.totalTimeMin)),
    budget_range: { min: Math.round(plan.totalCostEgp * 0.8), max: Math.round(plan.totalCostEgp * 1.6) },
    distance_km: Math.round(plan.distanceKm * 10) / 10,
    quality_score: plan.qualityScore, confidence: plan.confidence, transfers: plan.transfers,
    total_walk_minutes: Math.round(plan.totalWalkMin), explanation: explainPlan(plan, isArabic),
    plan: plan.plan, engine: "deterministic-graph",
  };
}

// Main entry: ONE pooled Dijkstra over every mode. The search returns its
// best-weight Pareto candidates; we reconstruct + validate them in order and
// return the first that passes the hard plan gates (a real, verified route is
// still mandatory — invalid plans are never returned). When none validate the
// caller serves a verified door-to-door taxi fallback.
export async function computeEnginePlan(req: PlanRequest): Promise<EnginePlan | null> {
  const graph = await buildGraph();
  const overlay = buildOverlay(graph, req.origin, req.dest, req.planKey);
  const profile = PROFILES[req.planKey];

  const allowedModes = allowedModesForPlan(req.planKey);
  const candidates = findRoutes(graph, overlay, "origin", "dest", profile, allowedModes, 10);

  let bestPlan: EnginePlan | null = null;
  for (const res of candidates) {
    const plan = reconstruct(graph, overlay, res, req.planKey, req.isArabic);
    if (!plan || plan.legs.length === 0) continue;
    const valid = validatePlan(plan, graph);
    const directKm = haversineKm(req.origin, req.dest);
    const isLoop = plan.distanceKm > Math.max(directKm * 2.2 + 2, directKm + 5);
    const wholeTripTaxi = req.planKey !== "premium" && plan.legs.length === 1 && plan.legs[0]?.mode === "taxi";
    if (valid.ok && !isLoop && !wholeTripTaxi) {
      bestPlan = plan;
      break;
    }
  }

  if (!bestPlan) return null;

  for (const leg of bestPlan.legs as (typeof bestPlan.legs[number] & { allowedSwaps?: string[] })[]) {
    if (leg.mode === "walk" || leg.mode === "taxi" || leg.mode === "tuktuk") {
      leg.allowedSwaps = ["walk", "taxi"];
    }
  }

  return bestPlan;
}

export async function planTripApi(req: PlanRequest) {
  const graph = await buildGraph();
  const plan = await computeEnginePlan(req);
  if (!plan) return null;
  return adaptPlanToApi(graph, plan, req.language ?? req.isArabic);
}
