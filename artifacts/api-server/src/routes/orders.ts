import { Router, type IRouter, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import {
  db,
  ordersTable,
  orderItemsTable,
  clientsTable,
  productsTable,
  shipmentsTable,
  orderPaymentsTable,
  deliveriesTable,
  sitesTable,
} from "@workspace/db";
import {
  ListOrdersQueryParams,
  CreateOrderBody,
  GetOrderParams,
  UpdateOrderParams,
  UpdateOrderBody,
  DeleteOrderParams,
  ListOrdersResponse,
  CreateOrderResponse,
  GetOrderResponse,
  UpdateOrderResponse,
  ListOrderPaymentsParams,
  ListOrderPaymentsResponse,
  CreateOrderPaymentParams,
  CreateOrderPaymentBody,
  CreateOrderPaymentResponse,
} from "@workspace/api-zod";
import { toOrderDto, getShippedQuantityMap, recalculateOrderIsPaid } from "../lib/orders";
import { requirePermission, requireSectionAccess } from "../middlewares/requirePermission";
import { effectiveOrderMonth, getOrderBilling, isOrderFrozen, validFulfillmentDelivery, BILLED_ORDER_ERROR } from "../lib/order-billing";
import { BillingError } from "../lib/order-summaries";

const router: IRouter = Router();
router.use("/orders", requireSectionAccess("orders"));
const canEditOrders = requirePermission("orders");

const CLIENT_NOT_FOUND_ERROR = "Выбранное юридическое лицо не найдено";
const SITE_NOT_FOUND_ERROR = "Выбранный магазин не найден";
const SITE_CLIENT_MISMATCH_ERROR =
  "Выбранный магазин не принадлежит указанному юридическому лицу";
const DELIVERY_SITE_MISMATCH_ERROR =
  "Нельзя изменить магазин заказа: он не совпадает с магазином связанной доставки";
const DELIVERY_MONTH_MISMATCH_ERROR =
  "Месяц заказа определяется исходной датой плана связанной доставки и не может изменяться отдельно";
// A dated delivery belongs to the month of its original planned date; an
// undated schedule row belongs to its schedule month. Never use corrections.
const effectiveMonth = effectiveOrderMonth;

type OrderDestination =
  | {
      client: typeof clientsTable.$inferSelect;
      site: typeof sitesTable.$inferSelect | null;
    }
  | { error: "client-not-found" | "site-not-found" | "site-client-mismatch" };

async function lockOrderDestination(
  tx: PgTransaction<any, any, any>,
  clientId: string,
  siteId: string | null,
): Promise<OrderDestination> {
  const [client] = await tx
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId))
    .for("update")
    .limit(1);
  if (!client) return { error: "client-not-found" };
  if (!siteId) return { client, site: null };

  const [site] = await tx
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.id, siteId))
    .for("update")
    .limit(1);
  if (!site) return { error: "site-not-found" };
  if (site.clientId !== clientId) return { error: "site-client-mismatch" };
  return { client, site };
}

function sendDestinationError(
  res: Response,
  error: Extract<OrderDestination, { error: string }>["error"],
): void {
  if (error === "client-not-found") {
    res.status(404).json({ error: CLIENT_NOT_FOUND_ERROR });
    return;
  }
  if (error === "site-not-found") {
    res.status(404).json({ error: SITE_NOT_FOUND_ERROR });
    return;
  }
  res.status(400).json({ error: SITE_CLIENT_MISMATCH_ERROR });
}

router.get("/orders", async (req, res): Promise<void> => {
  const query = ListOrdersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const conditions = [];
  if (query.data.clientId) conditions.push(eq(ordersTable.clientId, query.data.clientId));
  if (query.data.isPaid !== undefined) conditions.push(eq(ordersTable.isPaid, query.data.isPaid));
  if (query.data.plannedMonth === "without") conditions.push(sql`${effectiveMonth} is null`);
  else if (query.data.plannedMonth) conditions.push(sql`${effectiveMonth} = ${query.data.plannedMonth}`);

  const rows = await db
    .select({ order: ordersTable, clientName: clientsTable.name })
    .from(ordersTable)
    .innerJoin(clientsTable, eq(ordersTable.clientId, clientsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(ordersTable.createdAt);

  const dtos = await Promise.all(rows.map((row) => toOrderDto(row.order, row.clientName)));

  res.json(ListOrdersResponse.parse(dtos));
});

router.post("/orders", canEditOrders, async (req, res): Promise<void> => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const deliveryDate = parsed.data.plannedDeliveryDate;
  const date = new Date(`${deliveryDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== deliveryDate ||
      deliveryDate.slice(0, 7) !== parsed.data.plannedMonth) {
    res.status(400).json({ error: "Укажите корректную дату доставки в выбранном месяце плана" });
    return;
  }
  if (!parsed.data.siteId || parsed.data.fulfillmentDeliveryId) {
    res.status(400).json({ error: "Укажите магазин: для нового заказа доставка создаётся автоматически" });
    return;
  }

  const productIds = [...new Set(parsed.data.items.map((item) => item.productId))];
  const products = await db.select().from(productsTable);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const missing = productIds.filter((id) => !productMap.has(id));
  if (missing.length > 0) {
    res.status(404).json({ error: `Products not found: ${missing.join(", ")}` });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    const destination = await lockOrderDestination(
      tx,
      parsed.data.clientId,
      parsed.data.siteId ?? null,
    );
    if ("error" in destination) return destination;
    if (!await validFulfillmentDelivery(parsed.data.fulfillmentDeliveryId ?? null, destination.site?.id ?? null, tx)) {
      return { error: "invalid-fulfillment" as const };
    }

    const [createdOrder] = await tx
      .insert(ordersTable)
      .values({
        clientId: parsed.data.clientId,
        siteId: destination.site?.id ?? null,
        siteName: destination.site?.name ?? null,
        siteAddress: destination.site?.address ?? null,
        isPaid: false,
        note: parsed.data.note ?? null,
        plannedMonth: parsed.data.plannedMonth ?? null,
        fulfillmentDeliveryId: parsed.data.fulfillmentDeliveryId ?? null,
      })
      .returning();

    await tx.insert(orderItemsTable).values(
      parsed.data.items.map((item) => ({
        orderId: createdOrder.id,
        productId: item.productId,
        quantity: String(item.quantity),
        price: String(productMap.get(item.productId)!.price),
      })),
    );

    await tx.insert(deliveriesTable).values({
      siteId: destination.site!.id,
      orderId: createdOrder.id,
      plannedDate: deliveryDate,
      scheduleMonth: deliveryDate.slice(0, 7),
      driverUserId: destination.site!.driverUserId,
      deliveryType: "доп.заказ",
    });

    return { order: createdOrder, client: destination.client };
  });

  if ("error" in outcome) {
    if (outcome.error === "invalid-fulfillment") {
      res.status(400).json({ error: "Выберите активную основную доставку того же магазина" });
      return;
    }
    if (outcome.error) sendDestinationError(res, outcome.error);
    return;
  }

  res.status(201).json(
    CreateOrderResponse.parse(
      await toOrderDto(outcome.order, outcome.client.name),
    ),
  );
});

router.get("/orders/:id", async (req, res): Promise<void> => {
  const params = GetOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db
    .select({ order: ordersTable, clientName: clientsTable.name })
    .from(ordersTable)
    .innerJoin(clientsTable, eq(ordersTable.clientId, clientsTable.id))
    .where(eq(ordersTable.id, params.data.id));

  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  res.json(GetOrderResponse.parse(await toOrderDto(row.order, row.clientName)));
});

router.patch("/orders/:id", canEditOrders, async (req, res): Promise<void> => {
  const params = UpdateOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existingOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id));
  if (!existingOrder) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  if (parsed.data.items && existingOrder.isPaid) {
    res.status(400).json({ error: "Нельзя редактировать состав уже оплаченного заказа" });
    return;
  }

  const priceByProduct = new Map<string, string>();

  if (parsed.data.items) {
    const productIds = [...new Set(parsed.data.items.map((item) => item.productId))];
    const products = await db.select().from(productsTable);
    const productMap = new Map(products.map((p) => [p.id, p]));
    const missing = productIds.filter((id) => !productMap.has(id));
    if (missing.length > 0) {
      res.status(404).json({ error: `Products not found: ${missing.join(", ")}` });
      return;
    }

    for (const id of productIds) {
      priceByProduct.set(id, String(productMap.get(id)!.price));
    }

    const shippedMap = await getShippedQuantityMap(params.data.id);
    const newQuantityByProduct = new Map<string, number>();
    for (const item of parsed.data.items) {
      newQuantityByProduct.set(item.productId, (newQuantityByProduct.get(item.productId) ?? 0) + item.quantity);
    }

    for (const [productId, shippedQuantity] of shippedMap) {
      if (shippedQuantity <= 0) continue;
      const newQuantity = newQuantityByProduct.get(productId) ?? 0;
      if (newQuantity < shippedQuantity) {
        const productName = productMap.get(productId)?.name ?? productId;
        res.status(400).json({
          error: `Нельзя уменьшить количество товара "${productName}" ниже уже отгруженного (${shippedQuantity})`,
        });
        return;
      }
    }
  }

  const outcome = await db.transaction(async (tx) => {
    // Client first matches summary creation and serializes period membership.
    const destination = await lockOrderDestination(
            tx,
            existingOrder.clientId,
            parsed.data.siteId !== undefined ? parsed.data.siteId : null,
          );
    if (destination && "error" in destination) return destination;
    const [lockedOrder] = await tx.select().from(ordersTable)
      .where(eq(ordersTable.id, params.data.id)).for("update").limit(1);
    if (!lockedOrder) return { error: "order-not-found" as const };
    if ((parsed.data.items !== undefined || parsed.data.siteId !== undefined ||
      parsed.data.plannedMonth !== undefined || parsed.data.fulfillmentDeliveryId !== undefined) &&
      await isOrderFrozen(lockedOrder.id, tx)) {
      return { error: "frozen-order" as const };
    }

    const [linkedDelivery] = await tx
      .select({
        siteId: deliveriesTable.siteId,
        plannedDate: deliveriesTable.plannedDate,
        scheduleMonth: deliveriesTable.scheduleMonth,
      })
      .from(deliveriesTable)
      .where(eq(deliveriesTable.orderId, params.data.id))
      .for("update")
      .limit(1);
    if (
      parsed.data.siteId !== undefined &&
      linkedDelivery &&
      parsed.data.siteId !== linkedDelivery.siteId
    ) {
      return { error: "delivery-site-mismatch" as const };
    }
    if (linkedDelivery && parsed.data.plannedMonth !== undefined &&
      parsed.data.plannedMonth !== (linkedDelivery.plannedDate
        ? linkedDelivery.plannedDate.slice(0, 7)
        : linkedDelivery.scheduleMonth)) {
      return { error: "delivery-month-mismatch" as const };
    }

    if (parsed.data.fulfillmentDeliveryId !== undefined && linkedDelivery) {
      return { error: "invalid-fulfillment" as const };
    }
    const fulfillmentId = parsed.data.fulfillmentDeliveryId !== undefined
      ? parsed.data.fulfillmentDeliveryId : lockedOrder.fulfillmentDeliveryId;
    if ((parsed.data.fulfillmentDeliveryId !== undefined || parsed.data.siteId !== undefined) &&
      !await validFulfillmentDelivery(fulfillmentId, parsed.data.siteId !== undefined ? parsed.data.siteId : lockedOrder.siteId, tx)) {
      return { error: "invalid-fulfillment" as const };
    }
    const [ordinaryDelivery] = fulfillmentId ? await tx.select().from(deliveriesTable)
      .where(eq(deliveriesTable.id, fulfillmentId)).for("update").limit(1) : [];
    if (ordinaryDelivery && parsed.data.plannedMonth !== undefined &&
      parsed.data.plannedMonth !== (ordinaryDelivery.plannedDate?.slice(0, 7) ?? ordinaryDelivery.scheduleMonth)) {
      return { error: "delivery-month-mismatch" as const };
    }
    if (parsed.data.items) {
      const shipped = await getShippedQuantityMap(lockedOrder.id, tx);
      const quantities = new Map<string, number>();
      for (const item of parsed.data.items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
      for (const [productId, quantity] of shipped) {
        if ((quantities.get(productId) ?? 0) < quantity) return { error: "shipped-quantity" as const };
      }
    }

    const updateValues: Record<string, unknown> = {};
    if (parsed.data.note !== undefined) updateValues.note = parsed.data.note;
    if (parsed.data.fulfillmentDeliveryId !== undefined) updateValues.fulfillmentDeliveryId = parsed.data.fulfillmentDeliveryId;
    if (parsed.data.plannedMonth !== undefined && !linkedDelivery && !ordinaryDelivery) {
      updateValues.plannedMonth = parsed.data.plannedMonth;
    }
    if (parsed.data.siteId !== undefined && destination && !("error" in destination)) {
      updateValues.siteId = destination.site?.id ?? null;
      updateValues.siteName = destination.site?.name ?? null;
      updateValues.siteAddress = destination.site?.address ?? null;
    }

    let updatedOrder = lockedOrder;
    if (Object.keys(updateValues).length > 0) {
      const [row] = await tx
        .update(ordersTable)
        .set(updateValues)
        .where(eq(ordersTable.id, params.data.id))
        .returning();
      updatedOrder = row;
    }

    if (parsed.data.items) {
      await tx.delete(orderItemsTable).where(eq(orderItemsTable.orderId, params.data.id));
      await tx.insert(orderItemsTable).values(
        parsed.data.items.map((item) => ({
          orderId: params.data.id,
          productId: item.productId,
          quantity: String(item.quantity),
          price: priceByProduct.get(item.productId)!,
        })),
      );
    }

    return { order: updatedOrder };
  });

  if ("error" in outcome) {
    if (outcome.error === "frozen-order") {
      res.status(409).json({ error: BILLED_ORDER_ERROR });
      return;
    }
    if (outcome.error === "shipped-quantity") {
      res.status(400).json({ error: "Нельзя уменьшить количество ниже уже отгруженного" });
      return;
    }
    if (outcome.error === "invalid-fulfillment") {
      res.status(400).json({ error: "Выберите активную основную доставку того же магазина; дополнительная доставка привязана автоматически" });
      return;
    }
    if (
      outcome.error === "client-not-found" ||
      outcome.error === "site-not-found" ||
      outcome.error === "site-client-mismatch"
    ) {
      sendDestinationError(res, outcome.error);
      return;
    }
    if (outcome.error === "delivery-site-mismatch") {
      res.status(400).json({ error: DELIVERY_SITE_MISMATCH_ERROR });
      return;
    }
    if (outcome.error === "delivery-month-mismatch") {
      res.status(400).json({ error: DELIVERY_MONTH_MISMATCH_ERROR });
      return;
    }
    res.status(404).json({ error: "Заказ не найден" });
    return;
  }

  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, outcome.order.clientId));

  res.json(
    UpdateOrderResponse.parse(
      await toOrderDto(outcome.order, client?.name ?? ""),
    ),
  );
});

router.get("/orders/:id/payments", async (req, res): Promise<void> => {
  const params = ListOrderPaymentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const rows = await db
    .select()
    .from(orderPaymentsTable)
    .where(eq(orderPaymentsTable.orderId, params.data.id))
    .orderBy(orderPaymentsTable.createdAt);

  res.json(
    ListOrderPaymentsResponse.parse(
      rows.map((row) => ({
        id: row.id,
        orderId: row.orderId,
        amount: Number(row.amount),
        note: row.note,
        createdAt: row.createdAt,
      })),
    ),
  );
});

router.post("/orders/:id/payments", canEditOrders, async (req, res): Promise<void> => {
  const params = CreateOrderPaymentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CreateOrderPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existingOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id));
  if (!existingOrder) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, existingOrder.clientId));

  let order;
  try {
    order = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(ordersTable).where(eq(ordersTable.id, params.data.id)).for("update");
    if (!locked) throw new BillingError(404, "Заказ не найден");
    // A billed source must be paid through the summary, not a second ledger.
    if (await getOrderBilling(locked.id, tx)) throw new BillingError(409, "Оплатите сводный счёт, в который включён заказ");
    await tx.insert(orderPaymentsTable).values({
      orderId: params.data.id,
      amount: String(parsed.data.amount),
      note: parsed.data.note ?? null,
    });

    const itemRows = await tx
      .select({ quantity: orderItemsTable.quantity, price: orderItemsTable.price })
      .from(orderItemsTable)
      .where(eq(orderItemsTable.orderId, params.data.id));
    const totalAmount = itemRows.reduce((sum, item) => sum + Number(item.quantity) * Number(item.price), 0);

    await recalculateOrderIsPaid(params.data.id, totalAmount, tx);

    const [updatedOrder] = await tx.select().from(ordersTable).where(eq(ordersTable.id, params.data.id));
    return updatedOrder;
  });
  } catch (error) {
    if (!(error instanceof BillingError)) throw error;
    res.status(error.status).json({ error: error.message });
    return;
  }

  res.status(201).json(CreateOrderPaymentResponse.parse(await toOrderDto(order, client?.name ?? "")));
});

router.delete("/orders/:id", canEditOrders, async (req, res): Promise<void> => {
  const params = DeleteOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existingShipment] = await db
    .select({ id: shipmentsTable.id })
    .from(shipmentsTable)
    .where(eq(shipmentsTable.orderId, params.data.id));

  if (existingShipment) {
    res.status(409).json({ error: "Нельзя удалить заказ, по которому уже есть отгрузки" });
    return;
  }

  const [linkedDelivery] = await db
    .select({ id: deliveriesTable.id })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.orderId, params.data.id))
    .limit(1);
  if (linkedDelivery) {
    res.status(409).json({ error: "Нельзя удалить заказ, связанный с доставкой" });
    return;
  }

  let order: typeof ordersTable.$inferSelect | undefined;
  try {
    order = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(ordersTable)
        .where(eq(ordersTable.id, params.data.id)).for("update");
      if (!locked) return undefined;
      if (await isOrderFrozen(locked.id, tx)) throw new BillingError(409, BILLED_ORDER_ERROR);
      const [deleted] = await tx.delete(ordersTable).where(eq(ordersTable.id, params.data.id)).returning();
      return deleted;
    });
  } catch (error) {
    if (error instanceof BillingError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23503"
    ) {
      res.status(409).json({ error: "Нельзя удалить заказ, связанный с доставкой" });
      return;
    }
    throw error;
  }

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
