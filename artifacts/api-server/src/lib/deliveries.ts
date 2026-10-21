import { and, count, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  deliveriesTable,
  deliveryPhotosTable,
  orderItemsTable,
  productsTable,
} from "@workspace/db";
import { moscowDateISO } from "./calendar-month.ts";
export { currentMonth, monthRange } from "./calendar-month.ts";

export type DeliveryStatus = "pending" | "on_time" | "late" | "overdue";

// Local business date in Moscow time (users are Russian): avoids off-by-one
// around midnight compared to UTC-based toISOString().
export function todayLocalISO(): string {
  return moscowDateISO();
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
  enrichment: DeliveryDtoEnrichment | undefined = undefined,
) {
  const { status, lagDays } = computeStatus(row.plannedDate, row.actualDate);
  return {
    id: row.id,
    siteId: row.siteId,
    siteName,
    siteAddress,
    ...(enrichment?.tradeNetworkName !== undefined
      ? { tradeNetworkName: enrichment.tradeNetworkName }
      : {}),
    clientId: enrichment?.clientId ?? null,
    clientName: enrichment?.clientName ?? null,
    ...(managerContact ? { managerContact } : {}),
    driverUserId: row.driverUserId,
    driver,
    parentDeliveryId: row.parentDeliveryId,
    orderId: row.orderId,
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
    archivedAt: row.archivedAt,
    archivedByName: row.archivedByName,
    photosCount,
    createdAt: row.createdAt,
    ...(enrichment?.additionalOrderItems
      ? { additionalOrderItems: enrichment.additionalOrderItems }
      : {}),
    hasAdditionalOrders: enrichment?.hasAdditionalOrders ?? false,
  };
}

export type AdditionalOrderItemDto = {
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
};

export type DeliveryDtoEnrichment = {
  tradeNetworkName?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  additionalOrderItems?: AdditionalOrderItemDto[];
  hasAdditionalOrders?: boolean;
};

/**
 * Load supplemental-order contents for a complete delivery result set in
 * batches. Prices are deliberately not selected: this data is also returned
 * by driver-scoped routes.
 */
export async function deliveryDtoEnrichmentMap(
  deliveryIds: string[],
): Promise<Map<string, DeliveryDtoEnrichment>> {
  if (deliveryIds.length === 0) return new Map();

  const children = await db
    .select({
      id: deliveriesTable.id,
      parentDeliveryId: deliveriesTable.parentDeliveryId,
      orderId: deliveriesTable.orderId,
    })
    .from(deliveriesTable)
    .where(
      and(
        inArray(deliveriesTable.parentDeliveryId, deliveryIds),
        isNull(deliveriesTable.archivedAt),
      ),
    );
  const childrenByParent = new Map<string, typeof children>();
  for (const child of children) {
    if (!child.parentDeliveryId) continue;
    const bucket = childrenByParent.get(child.parentDeliveryId) ?? [];
    bucket.push(child);
    childrenByParent.set(child.parentDeliveryId, bucket);
  }

  const targetAndChildIds = [
    ...new Set([
      ...deliveryIds,
      ...children.map((child) => child.id),
    ]),
  ];
  const linkedDeliveries = await db
    .select({ id: deliveriesTable.id, orderId: deliveriesTable.orderId })
    .from(deliveriesTable)
    .where(inArray(deliveriesTable.id, targetAndChildIds));
  const orderIds = linkedDeliveries
    .map((delivery) => delivery.orderId)
    .filter((id): id is string => id !== null);

  const itemRows =
    orderIds.length === 0
      ? []
      : await db
          .select({
            orderId: orderItemsTable.orderId,
            productId: orderItemsTable.productId,
            productName: productsTable.name,
            quantity: orderItemsTable.quantity,
            unit: productsTable.unit,
          })
          .from(orderItemsTable)
          .innerJoin(
            productsTable,
            eq(orderItemsTable.productId, productsTable.id),
          )
          .where(inArray(orderItemsTable.orderId, orderIds));
  const itemsByOrder = new Map<string, AdditionalOrderItemDto[]>();
  for (const row of itemRows) {
    const bucket = itemsByOrder.get(row.orderId) ?? [];
    bucket.push({
      productId: row.productId,
      productName: row.productName,
      quantity: Number(row.quantity),
      unit: row.unit,
    });
    itemsByOrder.set(row.orderId, bucket);
  }
  const orderByDelivery = new Map(
    linkedDeliveries.map((delivery) => [delivery.id, delivery.orderId]),
  );

  const result = new Map<string, DeliveryDtoEnrichment>();
  for (const deliveryId of deliveryIds) {
    const ownOrderId = orderByDelivery.get(deliveryId);
    const childRows = childrenByParent.get(deliveryId) ?? [];
    const ownItems = ownOrderId ? (itemsByOrder.get(ownOrderId) ?? []) : [];
    const additionalOrderItems =
      ownOrderId !== null && ownOrderId !== undefined
        ? ownItems
        : [];
    result.set(deliveryId, {
      additionalOrderItems:
        additionalOrderItems.length > 0 ? additionalOrderItems : undefined,
      hasAdditionalOrders: childRows.length > 0,
    });
  }
  return result;
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
