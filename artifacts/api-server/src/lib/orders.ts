import { and, eq, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import {
  db,
  orderItemsTable,
  shipmentItemsTable,
  shipmentsTable,
  productsTable,
  orderPaymentsTable,
  ordersTable,
} from "@workspace/db";

type DbOrTx = typeof db | PgTransaction<any, any, any>;

export async function getPaidAmount(orderId: string, dbOrTx: DbOrTx = db): Promise<number> {
  const [row] = await dbOrTx
    .select({ total: sql<string>`coalesce(sum(${orderPaymentsTable.amount}), 0)` })
    .from(orderPaymentsTable)
    .where(eq(orderPaymentsTable.orderId, orderId));

  return Number(row?.total ?? 0);
}

export async function recalculateOrderIsPaid(
  orderId: string,
  totalAmount: number,
  dbOrTx: DbOrTx = db,
): Promise<{ paidAmount: number; isPaid: boolean }> {
  const paidAmount = await getPaidAmount(orderId, dbOrTx);
  const isPaid = paidAmount >= totalAmount && totalAmount > 0;

  await dbOrTx.update(ordersTable).set({ isPaid }).where(eq(ordersTable.id, orderId));

  return { paidAmount, isPaid };
}

export async function getShippedQuantityMap(
  orderId: string,
  dbOrTx: DbOrTx = db,
  excludeShipmentId?: string,
): Promise<Map<string, number>> {
  const conditions = [eq(shipmentsTable.orderId, orderId)];
  if (excludeShipmentId) {
    conditions.push(sql`${shipmentsTable.id} != ${excludeShipmentId}`);
  }

  const rows = await dbOrTx
    .select({
      productId: shipmentItemsTable.productId,
      total: sql<string>`sum(${shipmentItemsTable.quantity})`,
    })
    .from(shipmentItemsTable)
    .innerJoin(shipmentsTable, eq(shipmentItemsTable.shipmentId, shipmentsTable.id))
    .where(and(...conditions))
    .groupBy(shipmentItemsTable.productId);

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.productId, Number(row.total));
  }
  return map;
}

export async function toOrderDto(
  order: {
    id: string;
    clientId: string;
    isPaid: boolean;
    note: string | null;
    createdAt: Date;
  },
  clientName: string,
) {
  const itemRows = await db
    .select({ item: orderItemsTable, productName: productsTable.name })
    .from(orderItemsTable)
    .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(eq(orderItemsTable.orderId, order.id));

  const shippedMap = await getShippedQuantityMap(order.id);

  const items = itemRows.map((row) => {
    const quantity = Number(row.item.quantity);
    const shippedQuantity = shippedMap.get(row.item.productId) ?? 0;
    return {
      id: row.item.id,
      productId: row.item.productId,
      productName: row.productName,
      quantity,
      price: Number(row.item.price),
      shippedQuantity,
      remainingQuantity: quantity - shippedQuantity,
    };
  });

  const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const paidAmount = await getPaidAmount(order.id);
  const overpaidAmount = Math.max(0, paidAmount - totalAmount);

  return {
    id: order.id,
    clientId: order.clientId,
    clientName,
    isPaid: order.isPaid,
    paidAmount,
    overpaidAmount,
    note: order.note,
    items,
    totalAmount,
    createdAt: order.createdAt,
  };
}
