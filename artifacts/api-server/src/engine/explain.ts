import type { EnginePlan, PlanKey } from "./types.js";

// Deterministic, bilingual route explanation. The spec allows AI ONLY for
// explanations; we generate them deterministically so the engine stays
// fully offline-safe and never depends on a model to justify a route.
export function explainPlan(plan: EnginePlan, isArabic: boolean): string {
  const planLabel: Record<PlanKey, [string, string]> = {
    economic: ["Economic", "الاقتصادية"],
    comfortable: ["Comfortable", "المريحة"],
    premium: ["Premium", "المميزة"],
  };
  const [enLabel, arLabel] = planLabel[plan.plan];

  const modes = [...new Set(plan.legs.map((l) => l.mode))];
  const railOnly = modes.every((m) =>
    ["metro", "monorail", "train", "walk"].includes(m),
  );
  const hasTaxi = modes.includes("taxi");

  if (isArabic) {
    const bits = [
      `أفضل خيار ضمن خطتك ${arLabel}.`,
      `الوقت ${Math.round(plan.totalTimeMin)} دقيقة، التكلفة ${Math.round(plan.totalCostEgp)} جنيه،`,
      `${plan.transfers} تبديل ومشي ${Math.round(plan.totalWalkMin)} دقيقة.`,
    ];
    if (railOnly) bits.push("يعتمد على وسائل ثابتة وموثوقة (مترو/قطار).");
    else if (hasTaxi) bits.push("يستخدم سيارة لتقليل المشي ووقت الانتظار.");
    else bits.push("يوازن بين التكلفة والوقت باستخدام المواصلات العامة.");
    bits.push(`جودة المسار ${plan.qualityScore}/100.`);
    return bits.join(" ");
  }

  const bits = [
    `Best option within your ${enLabel} plan.`,
    `About ${Math.round(plan.totalTimeMin)} min, ${Math.round(plan.totalCostEgp)} EGP,`,
    `${plan.transfers} transfer${plan.transfers === 1 ? "" : "s"} and ${Math.round(plan.totalWalkMin)} min walking.`,
  ];
  if (railOnly) bits.push("It relies on fixed, high-reliability rail.");
  else if (hasTaxi) bits.push("It uses a car to cut walking and waiting.");
  else bits.push("It balances cost and time on public transport.");
  bits.push(`Route quality ${plan.qualityScore}/100.`);
  return bits.join(" ");
}
