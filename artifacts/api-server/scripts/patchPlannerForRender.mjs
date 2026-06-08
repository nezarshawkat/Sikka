import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function replaceRequired(source, label, from, to, fileName = "source") {
  if (!source.includes(from)) {
    throw new Error(`Could not find ${label} in ${fileName}`);
  }
  return source.replace(from, to);
}

function patchFile(file, patches) {
  let source = readFileSync(file, "utf8");
  for (const patch of patches) {
    source = replaceRequired(source, patch.label, patch.from, patch.to, path.basename(file));
  }
  writeFileSync(file, source);
}

export function patchPlannerForRender(artifactDir) {
  patchFile(path.resolve(artifactDir, "src/engine/graph.ts"), [
    {
      label: "transfer link cap",
      from: "const MAX_TRANSFER_LINKS = 40; // dramatically increased to prevent dropped connections in dense Cairo corridors",
      to: "const MAX_TRANSFER_LINKS = Number(process.env.SIKKA_MAX_TRANSFER_LINKS ?? \"16\"); // Render-safe cap; raise via env on larger instances",
    },
    {
      label: "dense synthetic spacing",
      from: "const DENSE_SPACING_KM = 1.0; // board-anywhere: virtual boarding point every ~1 km",
      to: "const DENSE_SPACING_KM = Number(process.env.SIKKA_DENSE_SPACING_KM ?? \"1.6\"); // board-anywhere spacing; lower via env on larger instances",
    },
  ]);

  patchFile(path.resolve(artifactDir, "src/engine/pathfinder.ts"), [
    {
      label: "search budget constants",
      from: "const MAX_TOTAL_WALK_MIN = WALK_MAX_TOTAL_MIN;\n\n// Only walk is a universal connector.",
      to: "const MAX_TOTAL_WALK_MIN = WALK_MAX_TOTAL_MIN;\nconst MAX_LABELS_PER_NODE = Number(process.env.SIKKA_MAX_LABELS_PER_NODE ?? \"5\");\nconst MAX_EXPANDED_LABELS = Number(process.env.SIKKA_MAX_EXPANDED_LABELS ?? \"30000\");\n\n// Only walk is a universal connector.",
    },
    {
      label: "bounded labels per node",
      from: "    if (existing) existing.push(lab);\n    else labelsByNode.set(node, [lab]);\n    heap.push(weight, lab);",
      to: "    if (existing) {\n      existing.push(lab);\n      if (existing.length > MAX_LABELS_PER_NODE) {\n        existing.sort((a, b) => a.weight - b.weight || a.walk - b.walk || a.cwalk - b.cwalk);\n        for (const l of existing.slice(MAX_LABELS_PER_NODE)) l.alive = false;\n        existing.length = MAX_LABELS_PER_NODE;\n      }\n    } else labelsByNode.set(node, [lab]);\n    heap.push(weight, lab);",
    },
    {
      label: "expanded label budget",
      from: "  const goalLabels: Label[] = [];\n  while (heap.size > 0) {\n    const lab = heap.pop()!;",
      to: "  const goalLabels: Label[] = [];\n  let expandedLabels = 0;\n  while (heap.size > 0 && expandedLabels < MAX_EXPANDED_LABELS) {\n    const lab = heap.pop()!;\n    expandedLabels++;",
    },
  ]);

  patchFile(path.resolve(artifactDir, "src/engine/planner.ts"), [
    {
      label: "access stop limit",
      from: "const ACCESS_STOP_LIMIT = 120;",
      to: "const ACCESS_STOP_LIMIT = Number(process.env.SIKKA_ACCESS_STOP_LIMIT ?? \"48\");",
    },
    {
      label: "computeEnginePlan signature",
      from: "export async function computeEnginePlan(req: PlanRequest): Promise<EnginePlan | null> {\n  const graph = await buildGraph();",
      to: "export async function computeEnginePlan(req: PlanRequest, graphOverride?: TransitGraph): Promise<EnginePlan | null> {\n  const graph = graphOverride ?? await buildGraph();",
    },
    {
      label: "route candidate count",
      from: "  const candidates = findRoutes(graph, overlay, \"origin\", \"dest\", profile, allowedModes, 10);",
      to: "  const candidates = findRoutes(graph, overlay, \"origin\", \"dest\", profile, allowedModes, Number(process.env.SIKKA_MAX_ROUTE_CANDIDATES ?? \"4\"));",
    },
    {
      label: "planTripApi duplicate graph build",
      from: "  const plan = await computeEnginePlan(req);",
      to: "  const plan = await computeEnginePlan(req, graph);",
    },
    {
      label: "onStreetGeometry connector snapping",
      from: `async function onStreetGeometry(leg: PlanLeg): Promise<number[][]> {
  if (leg.mode === "walk" || leg.mode === "taxi" || leg.mode === "tuktuk") {`,
      to: `async function onStreetGeometry(leg: PlanLeg): Promise<number[][]> {
  if (
    (leg.mode === "walk" || leg.mode === "taxi" || leg.mode === "tuktuk") &&
    process.env.SIKKA_ENABLE_LIVE_CONNECTOR_SNAPPING !== "true"
  ) {
    return leg.geometry?.length >= 2 ? leg.geometry : interpolateLine(leg.startCoord, leg.endCoord);
  }
  if (leg.mode === "walk" || leg.mode === "taxi" || leg.mode === "tuktuk") {`,
    },
  ]);

  console.log("Applied Render planner memory patch while preserving deterministic route selection.");
}
