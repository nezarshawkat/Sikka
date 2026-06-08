import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function replaceRequired(source, label, from, to) {
  if (!source.includes(from)) {
    throw new Error(`Could not find ${label} in planner.ts`);
  }
  return source.replace(from, to);
}

export function patchPlannerForRender(artifactDir) {
  const plannerFile = path.resolve(artifactDir, "src/engine/planner.ts");
  let source = readFileSync(plannerFile, "utf8");

  source = replaceRequired(
    source,
    "computeEnginePlan signature",
    "export async function computeEnginePlan(req: PlanRequest): Promise<EnginePlan | null> {\n  const graph = await buildGraph();",
    "export async function computeEnginePlan(req: PlanRequest, graphOverride?: TransitGraph): Promise<EnginePlan | null> {\n  const graph = graphOverride ?? await buildGraph();",
  );

  source = replaceRequired(
    source,
    "planTripApi duplicate graph build",
    "  const plan = await computeEnginePlan(req);",
    "  const plan = await computeEnginePlan(req, graph);",
  );

  source = replaceRequired(
    source,
    "onStreetGeometry connector snapping",
    `async function onStreetGeometry(leg: PlanLeg): Promise<number[][]> {
  if (leg.mode === "walk" || leg.mode === "taxi" || leg.mode === "tuktuk") {`,
    `async function onStreetGeometry(leg: PlanLeg): Promise<number[][]> {
  if (
    (leg.mode === "walk" || leg.mode === "taxi" || leg.mode === "tuktuk") &&
    process.env.SIKKA_ENABLE_LIVE_CONNECTOR_SNAPPING !== "true"
  ) {
    return leg.geometry?.length >= 2 ? leg.geometry : interpolateLine(leg.startCoord, leg.endCoord);
  }
  if (leg.mode === "walk" || leg.mode === "taxi" || leg.mode === "tuktuk") {`,
  );

  writeFileSync(plannerFile, source);
  console.log("Applied Render planner performance patch while preserving deterministic route selection.");
}
