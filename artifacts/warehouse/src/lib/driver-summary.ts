export interface DriverDayCounts {
  plan: number;
  done: number;
  closed: number;
  failed: number;
}

export interface DriverSummaryRow {
  key: string;
  driver: string;
  days: DriverDayCounts[];
  undated: number;
}

interface SummaryDelivery {
  driverUserId: string | null;
  driver: string;
  plannedDate: string | null;
  actualDate: string | null;
  scheduleMonth: string | null;
  workflowStatus: "planned" | "done" | "closed";
}

interface SummaryDriver {
  id: string;
  name?: string | null;
  email: string;
}

export function buildDriverSummary(
  deliveries: readonly SummaryDelivery[],
  drivers: readonly SummaryDriver[],
  month: string,
): DriverSummaryRow[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const [year, monthNumber] = month.split("-").map(Number);
  const dayCount = new Date(year, monthNumber, 0).getDate();
  const rows = new Map<string, DriverSummaryRow>();
  const ensureRow = (key: string, driver: string) => {
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        driver,
        days: Array.from({ length: dayCount }, () => ({
          plan: 0, done: 0, closed: 0, failed: 0,
        })),
        undated: 0,
      };
      rows.set(key, row);
    }
    return row;
  };
  for (const driver of drivers) {
    ensureRow(driver.id, driver.name || driver.email);
  }
  const dayIndex = (value: string | null) => {
    const date = value?.slice(0, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(0, 7) !== month) return -1;
    const day = Number(date.slice(8, 10));
    return day >= 1 && day <= dayCount ? day - 1 : -1;
  };
  for (const delivery of deliveries) {
    const ownerMonth = delivery.scheduleMonth ?? delivery.plannedDate?.slice(0, 7);
    if (ownerMonth !== month) continue;
    const row = ensureRow(
      delivery.driverUserId ?? "unassigned",
      delivery.driverUserId ? delivery.driver || "Водитель" : "Не назначен",
    );
    if (!delivery.plannedDate) row.undated++;
    const plannedDay = dayIndex(delivery.plannedDate);
    const actualDay = dayIndex(delivery.actualDate);
    if (plannedDay >= 0) {
      row.days[plannedDay].plan++;
      if (!delivery.actualDate) row.days[plannedDay].failed++;
    }
    if (actualDay >= 0) {
      if (delivery.workflowStatus === "closed") row.days[actualDay].closed++;
      else if (delivery.workflowStatus === "done") row.days[actualDay].done++;
    }
  }
  return [...rows.values()].sort((a, b) => {
    if (a.key === "unassigned") return 1;
    if (b.key === "unassigned") return -1;
    return a.driver.localeCompare(b.driver, "ru") || a.key.localeCompare(b.key);
  });
}