import { and, eq, isNull, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import {
  db, ordersTable, deliveriesTable, deliveryPhotosTable, shipmentsTable,
  orderSummaryMembersTable, orderSummariesTable,
} from "@workspace/db";
import { orderNumber, resolveOrderStatus } from "./order-lifecycle";

export type OrderDb = typeof db | PgTransaction<any, any, any>;
export const BILLED_ORDER_ERROR = "Нельзя изменять оплаченный заказ или заказ, включённый в сводный счёт";

// Additional-order reverse links have precedence, never infer a delivery
// from matching site/date and never populate deliveries.orderId for ordinary orders.
export const effectiveOrderMonth = sql<string | null>`case
  when exists (select 1 from deliveries d where d.order_id = ${ordersTable.id})
  then (select coalesce(substring(d.planned_date::text from 1 for 7), d.schedule_month)
    from deliveries d where d.order_id = ${ordersTable.id} limit 1)
  when ${ordersTable.fulfillmentDeliveryId} is not null
  then (select coalesce(substring(d.planned_date::text from 1 for 7), d.schedule_month)
    from deliveries d where d.id = ${ordersTable.fulfillmentDeliveryId} limit 1)
  else ${ordersTable.plannedMonth} end`;

export async function getOrderBilling(orderId: string, connection: OrderDb = db) {
  const [row] = await connection.select({ summary: orderSummariesTable })
    .from(orderSummaryMembersTable)
    .innerJoin(orderSummariesTable, eq(orderSummariesTable.id, orderSummaryMembersTable.summaryId))
    .where(eq(orderSummaryMembersTable.orderId, orderId));
  return row?.summary ?? null;
}

export async function isOrderFrozen(orderId: string, connection: OrderDb = db) {
  const [order] = await connection.select({ isPaid: ordersTable.isPaid })
    .from(ordersTable).where(eq(ordersTable.id, orderId));
  return !!order?.isPaid || !!await getOrderBilling(orderId, connection);
}

export async function getOrderLifecycle(
  order: { id: string; isPaid: boolean; fulfillmentDeliveryId?: string | null },
  connection: OrderDb = db,
) {
  const summary = await getOrderBilling(order.id, connection);
  const [reverse] = await connection.select().from(deliveriesTable)
    .where(eq(deliveriesTable.orderId, order.id)).limit(1);
  const delivery = reverse ?? (order.fulfillmentDeliveryId
    ? (await connection.select().from(deliveriesTable)
      .where(eq(deliveriesTable.id, order.fulfillmentDeliveryId)).limit(1))[0] : undefined);
  const [photo] = delivery ? await connection.select({ id: deliveryPhotosTable.id })
    .from(deliveryPhotosTable).where(and(
      eq(deliveryPhotosTable.deliveryId, delivery.id), isNull(deliveryPhotosTable.deletionPendingAt),
    )).limit(1) : [];
  const [shipment] = await connection.select({ id: shipmentsTable.id }).from(shipmentsTable)
    .where(and(eq(shipmentsTable.orderId, order.id), eq(shipmentsTable.isDeleted, false))).limit(1);
  return {
    summaryId: summary?.id ?? null,
    fulfillmentDeliveryId: delivery?.id ?? null,
    deliveryFromAdditionalOrder: !!reverse,
    orderNumber: orderNumber(order.id),
    status: resolveOrderStatus({
      isPaid: order.isPaid, summary,
      actualDate: delivery?.actualDate,
      activePhoto: !!photo, activeDelivery: !!delivery && !delivery.archivedAt && !delivery.deletionPendingAt,
      shipped: !!shipment,
    }),
    delivery,
    summary,
  };
}

export async function validFulfillmentDelivery(
  id: string | null, siteId: string | null, connection: OrderDb,
) {
  if (!id) return true;
  const [delivery] = await connection.select().from(deliveriesTable)
    .where(eq(deliveriesTable.id, id)).for("update").limit(1);
  return !!delivery && delivery.siteId === siteId && !delivery.parentDeliveryId &&
    !delivery.orderId && !delivery.archivedAt && !delivery.deletionPendingAt;
}

// Call after locking the delivery row. Summary creation holds the same row
// until memberships are committed, so this read cannot miss a racing bill.
export async function deliveryHasFrozenOrder(deliveryId: string, connection: OrderDb) {
  const [row] = await connection.select({ id: ordersTable.id }).from(ordersTable)
    .where(sql`(${ordersTable.fulfillmentDeliveryId} = ${deliveryId} or
      ${ordersTable.id} = (select d.order_id from deliveries d where d.id = ${deliveryId}))
      and (${ordersTable.isPaid} = true or exists
        (select 1 from order_summary_members m where m.order_id = ${ordersTable.id}))`).limit(1);
  return !!row;
}