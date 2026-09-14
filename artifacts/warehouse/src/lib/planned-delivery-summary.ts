import { toDateInputValue } from "./delivery-workspace.ts";

type PlannedDelivery = {
  plannedDate: string | null;
  actualDate: string | null;
  workflowStatus?: "planned" | "done" | "closed";
  archivedAt?: string | null;
};

export type PlannedDeliveryStatus = "done" | "closed" | "failed";

export function getPlannedDeliveryStatus(
  delivery: PlannedDelivery,
): PlannedDeliveryStatus | null {
  if (delivery.archivedAt || !delivery.plannedDate) return null;
  if (!delivery.actualDate) return "failed";
  return delivery.workflowStatus === "closed" ? "closed" : "done";
}

export function matchesPlannedDeliveryDay(
  delivery: PlannedDelivery,
  day: string,
  status: "plan" | PlannedDeliveryStatus = "plan",
): boolean {
  const deliveryStatus = getPlannedDeliveryStatus(delivery);
  return deliveryStatus !== null &&
    toDateInputValue(delivery.plannedDate) === day &&
    (status === "plan" || status === deliveryStatus);
}

export function getPlannedDayTotals(
  deliveries: readonly PlannedDelivery[],
  day: string,
) {
  const totals = { plan: 0, done: 0, closed: 0, failed: 0 };
  for (const delivery of deliveries) {
    if (!matchesPlannedDeliveryDay(delivery, day)) continue;
    const status = getPlannedDeliveryStatus(delivery)!;
    totals.plan++;
    totals[status]++;
  }
  return {
    ...totals,
    completedPercent: totals.plan > 0
      ? (totals.done + totals.closed) / totals.plan * 100
      : null,
  };
}