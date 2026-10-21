type PlanDates = {
  plannedDate?: string | null;
  correctedPlannedDate?: string | null;
};

export function hasCorrectedPlan(delivery: PlanDates): boolean {
  return Boolean(delivery.correctedPlannedDate);
}

export function summarizeCorrectedPlans(deliveries: readonly PlanDates[]) {
  const planCount = deliveries.filter((delivery) => delivery.plannedDate).length;
  const count = deliveries.filter(hasCorrectedPlan).length;
  return { count, percent: planCount > 0 ? (count / planCount) * 100 : 0 };
}