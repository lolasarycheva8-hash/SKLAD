import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db, clientsTable, ordersTable, orderItemsTable, productsTable,
  deliveriesTable, orderSummariesTable, orderSummaryMembersTable, orderSummaryItemsTable,
} from "@workspace/db";
import { effectiveOrderMonth, getOrderLifecycle, type OrderDb } from "./order-billing";
import { groupBillingLines, validBillingPeriod, type OrderStatus } from "./order-lifecycle";

type Period = { clientId: string; periodFrom: string; periodTo: string };
type Blocker = { id: string; number: string; status: OrderStatus; reason: string };
export class BillingError extends Error {
  constructor(public status: number, message: string, public blockers: Blocker[] = []) {
    super(message);
  }
}

export async function summaryDto(summary: typeof orderSummariesTable.$inferSelect, connection: OrderDb = db) {
  const members = await connection.select().from(orderSummaryMembersTable)
    .where(eq(orderSummaryMembersTable.summaryId, summary.id)).orderBy(asc(orderSummaryMembersTable.orderNumber));
  const items = await connection.select().from(orderSummaryItemsTable)
    .where(eq(orderSummaryItemsTable.summaryId, summary.id))
    .orderBy(asc(orderSummaryItemsTable.productId), asc(orderSummaryItemsTable.price));
  return {
    id: summary.id, number: `СЗ-${String(summary.number).padStart(6, "0")}`,
    clientId: summary.clientId, clientName: summary.clientName,
    periodFrom: summary.periodFrom, periodTo: summary.periodTo,
    status: summary.paidAt ? "paid" as const : "awaiting_payment" as const,
    totalAmount: Number(summary.totalAmount), createdAt: summary.createdAt, paidAt: summary.paidAt,
    orders: members.map((m) => ({ id: m.orderId, number: m.orderNumber })),
    items: items.map((i) => ({
      productId: i.productId, productName: i.productName, unit: i.unit,
      quantity: Number(i.quantity), price: Number(i.price), total: Number(i.total),
    })),
  };
}

function validatePeriod(input: Period) {
  if (!validBillingPeriod(input.periodFrom, input.periodTo)) {
    throw new BillingError(400, "Укажите корректный период YYYY-MM: начало не может быть позже окончания");
  }
}

export async function previewSummary(input: Period, connection: OrderDb = db) {
  validatePeriod(input);
  const [client] = await connection.select().from(clientsTable).where(eq(clientsTable.id, input.clientId));
  if (!client) throw new BillingError(404, "Юридическое лицо не найдено");
  const sources = await connection.select().from(ordersTable).where(and(
    eq(ordersTable.clientId, input.clientId),
    sql`${effectiveOrderMonth} >= ${input.periodFrom}`,
    sql`${effectiveOrderMonth} <= ${input.periodTo}`,
  )).orderBy(asc(ordersTable.id));
  if (!sources.length) throw new BillingError(409, "В выбранном периоде нет заказов");
  const orders: { id: string; number: string }[] = [];
  const blockers: Blocker[] = [];
  for (const source of sources) {
    const lifecycle = await getOrderLifecycle(source, connection);
    const identity = { id: source.id, number: lifecycle.orderNumber };
    if (lifecycle.status === "delivered") orders.push(identity);
    else blockers.push({
      ...identity, status: lifecycle.status,
      reason: lifecycle.summaryId ? "Заказ уже включён в сводный счёт" :
        lifecycle.status === "paid" ? "Заказ уже оплачен" :
          "Заказ не доставлен: требуется фактическая дата и активный загруженный акт",
    });
  }
  const rows = orders.length ? await connection.select({
    productId: orderItemsTable.productId, productName: productsTable.name, unit: productsTable.unit,
    quantity: orderItemsTable.quantity, price: orderItemsTable.price,
  }).from(orderItemsTable).innerJoin(productsTable, eq(productsTable.id, orderItemsTable.productId))
    .where(inArray(orderItemsTable.orderId, orders.map((o) => o.id))) : [];
  const items = groupBillingLines(rows.map((r) => ({ ...r, quantity: Number(r.quantity), price: Number(r.price) })));
  return { orders, blockers, items, totalAmount: Math.round(items.reduce((sum, i) => sum + i.total, 0) * 100) / 100 };
}

export async function createSummary(input: Period & { requestId: string }) {
  validatePeriod(input);
  return db.transaction(async (tx) => {
    // Serialize retries globally by request UUID (including retries with another client).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.requestId}, 0))`);
    const [replay] = await tx.select().from(orderSummariesTable)
      .where(eq(orderSummariesTable.requestId, input.requestId));
    if (replay) {
      if (replay.clientId !== input.clientId || replay.periodFrom !== input.periodFrom || replay.periodTo !== input.periodTo) {
        throw new BillingError(400, "requestId уже использован для другого запроса");
      }
      return summaryDto(replay, tx);
    }
    const [client] = await tx.select().from(clientsTable)
      .where(eq(clientsTable.id, input.clientId)).for("update");
    if (!client) throw new BillingError(404, "Юридическое лицо не найдено");
    // All client orders: a delivery/month change cannot enter or leave the
    // selected period while we revalidate. The client lock serializes the
    // additional-order path (client -> site -> delivery -> new order).
    // NO KEY UPDATE still serializes source mutations but permits FK KEY SHARE
    // checks, avoiding an order/delivery FK-check lock inversion. Delivery
    // mutation guards only read orders with MVCC; they never lock orders.
    const sources = await tx.select().from(ordersTable)
      .where(eq(ordersTable.clientId, input.clientId)).orderBy(asc(ordersTable.id)).for("no key update");
    const sourceIds = sources.map((o) => o.id);
    const linkIds = sources.flatMap((o) => o.fulfillmentDeliveryId ? [o.fulfillmentDeliveryId] : []);
    if (sourceIds.length) {
      await tx.select().from(deliveriesTable).where(sql`
        ${deliveriesTable.orderId} in (${sql.join(sourceIds.map((id) => sql`${id}`), sql`,`)})
        ${linkIds.length ? sql`or ${deliveriesTable.id} in (${sql.join(linkIds.map((id) => sql`${id}`), sql`,`)})` : sql``}
      `).orderBy(asc(deliveriesTable.id)).for("update");
    }
    const preview = await previewSummary(input, tx);
    if (preview.blockers.length) {
      throw new BillingError(409, "Сводный счёт не создан: все заказы периода должны быть доставлены и не включены в другой счёт", preview.blockers);
    }
    if (!preview.items.length) throw new BillingError(409, "В заказах отсутствуют товары");
    const [summary] = await tx.insert(orderSummariesTable).values({
      requestId: input.requestId, clientId: input.clientId, clientName: client.name,
      periodFrom: input.periodFrom, periodTo: input.periodTo, totalAmount: String(preview.totalAmount),
    }).returning();
    await tx.insert(orderSummaryItemsTable).values(preview.items.map((item) => ({
      ...item, summaryId: summary.id, quantity: String(item.quantity), price: String(item.price), total: String(item.total),
    })));
    await tx.insert(orderSummaryMembersTable).values(preview.orders.map((order) => ({
      summaryId: summary.id, orderId: order.id, orderNumber: order.number,
    })));
    return summaryDto(summary, tx);
  });
}

export async function paySummary(id: string) {
  return db.transaction(async (tx) => {
    // Match createSummary's lock order (client -> orders -> summary).
    const [initial] = await tx.select().from(orderSummariesTable).where(eq(orderSummariesTable.id, id));
    if (!initial) throw new BillingError(404, "Сводный счёт не найден");
    await tx.select().from(clientsTable).where(eq(clientsTable.id, initial.clientId)).for("update");
    const members = await tx.select().from(orderSummaryMembersTable).where(eq(orderSummaryMembersTable.summaryId, id));
    const ids = members.map((m) => m.orderId).sort();
    if (ids.length) await tx.select().from(ordersTable).where(inArray(ordersTable.id, ids)).orderBy(asc(ordersTable.id)).for("no key update");
    const [locked] = await tx.select().from(orderSummariesTable).where(eq(orderSummariesTable.id, id)).for("update");
    const summary = locked.paidAt ? locked : (await tx.update(orderSummariesTable)
      .set({ paidAt: new Date() }).where(eq(orderSummariesTable.id, id)).returning())[0];
    if (ids.length) await tx.update(ordersTable).set({ isPaid: true }).where(inArray(ordersTable.id, ids));
    // Never manufacture individual payment transactions.
    return summaryDto(summary, tx);
  });
}