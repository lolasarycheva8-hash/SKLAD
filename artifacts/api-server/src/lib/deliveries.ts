import { and, count, inArray, isNull } from "drizzle-orm";
import { db, deliveriesTable, deliveryPhotosTable } from "@workspace/db";

export type DeliveryStatus = "pending" | "on_time" | "late" | "overdue";

// Local business date in Moscow time (users are Russian): avoids off-by-one
// around midnight compared to UTC-based toISOString().
export function todayLocalISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function todayISO(): string {
  return todayLocalISO();
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24),
  );
}

export function computeStatus(
  plannedDate: string | null,
  actualDate: string | null,
): { status: DeliveryStatus; lagDays: number | null } {
  if (!plannedDate) {
    return { status: "pending", lagDays: null };
  }
  if (actualDate) {
    const lagDays = daysBetween(plannedDate, actualDate);
    return { status: lagDays > 0 ? "late" : "on_time", lagDays };
  }

  if (plannedDate < todayISO()) {
    return { status: "overdue", lagDays: daysBetween(plannedDate, todayISO()) };
  }

  return { status: "pending", lagDays: null };
}

export function toDeliveryDto(
  row: typeof deliveriesTable.$inferSelect,
  siteName: string,
  siteAddress: string,
  photosCount = 0,
  driver = "Не назначен",
  managerContact: string | null = null,
) {
  const { status, lagDays } = computeStatus(row.plannedDate, row.actualDate);
  return {
    id: row.id,
    siteId: row.siteId,
    siteName,
    siteAddress,
    ...(managerContact ? { managerContact } : {}),
    driverUserId: row.driverUserId,
    driver,
    plannedDate: row.plannedDate,
    correctedPlannedDate: row.correctedPlannedDate,
    deliveryType: row.deliveryType,
    scheduleMonth: row.scheduleMonth,
    actualDate: row.actualDate,
    actApprovedAt: row.actApprovedAt,
    actApprovedBy: row.actApprovedBy,
    workflowStatus: !row.plannedDate
      ? ("planned" as const)
      : row.actApprovedAt
        ? ("closed" as const)
        : row.actualDate
          ? ("done" as const)
          : ("planned" as const),
    note: row.note,
    logisticianNote: row.logisticianNote,
    status,
    lagDays,
    rescheduledFromDate: row.rescheduledFromDate,
    rescheduledBy: row.rescheduledBy,
    rescheduledAt: row.rescheduledAt,
    photosCount,
    createdAt: row.createdAt,
  };
}

export async function photosCountMap(
  deliveryIds: string[],
): Promise<Map<string, number>> {
  if (deliveryIds.length === 0) return new Map();
  const rows = await db
    .select({ deliveryId: deliveryPhotosTable.deliveryId, cnt: count() })
    .from(deliveryPhotosTable)
    .where(
      and(
        inArray(deliveryPhotosTable.deliveryId, deliveryIds),
        isNull(deliveryPhotosTable.deletionPendingAt),
      ),
    )
    .groupBy(deliveryPhotosTable.deliveryId);
  return new Map(rows.map((r) => [r.deliveryId, Number(r.cnt)]));
}

export function monthRange(month: string): { start: string; end: string } {
  const [year, mon] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = new Date(Date.UTC(year, mon, 1)).toISOString().slice(0, 10);
  return { start, end };
}

export function currentMonth(): string {
  return todayISO().slice(0, 7);
}
