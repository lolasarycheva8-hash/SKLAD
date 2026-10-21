import { toDateInputValue } from "./delivery-workspace.ts";

type ProgressDelivery = {
  plannedDate: string | null;
  actualDate: string | null;
  archivedAt?: string | null;
  workflowStatus?: string;
  actApprovedAt?: string | null;
};

/** Month-wide totals, independent of table status/search filters. */
export function getDeliveryProgress(
  deliveries: readonly ProgressDelivery[],
  month: string,
  today: string,
) {
  const start = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const end = `${month}-${new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()}`;
  const previousDay = new Date(`${today}T12:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const yesterday = previousDay.toISOString().slice(0, 10);
  const through = yesterday < end ? yesterday : end;
  const started = through >= start;
  const monthThrough = today < end ? today : end;
  const todayActive = today >= start && today <= end;
  const rows = deliveries.filter((row) =>
    !row.archivedAt && row.plannedDate &&
    toDateInputValue(row.plannedDate).slice(0, 7) === month,
  );
  const completed = rows.filter((row) => {
    const actual = toDateInputValue(row.actualDate);
    return actual >= start && actual <= monthThrough;
  });
  const countClosed = (group: typeof completed) => group.filter((row) =>
    row.workflowStatus === "closed",
  ).length;
  const periodCompleted = completed.filter(row => toDateInputValue(row.actualDate) <= through);
  const todayCompleted = todayActive
    ? completed.filter(row => toDateInputValue(row.actualDate) === today) : [];
  const periodPlanned = started ? rows.filter((row) =>
    toDateInputValue(row.plannedDate) <= through,
  ) : [];
  const periodPlan = periodPlanned.length;
  const periodNotDone = periodPlanned.filter((row) => {
    const actual = toDateInputValue(row.actualDate);
    return !actual || actual > through;
  }).length;
  return {
    monthPlan: rows.length,
    done: completed.length,
    closed: countClosed(completed),
    periodPlan,
    periodNotDone,
    periodFact: periodCompleted.length,
    periodClosed: countClosed(periodCompleted),
    today,
    todayActive,
    todayPlan: todayActive ? rows.filter(row => toDateInputValue(row.plannedDate) === today).length : 0,
    todayFact: todayCompleted.length,
    todayClosed: countClosed(todayCompleted),
    periodEmptyLabel: today < start ? "Месяц ещё не начался" : "С начала месяца по вчера дней ещё нет",
    start,
    through,
    started,
  };
}

export type DeliveryProgress = ReturnType<typeof getDeliveryProgress>;

export function deliveryProgressPercent(value: number, plan: number): string {
  return plan > 0
    ? `${(value / plan * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`
    : "—";
}