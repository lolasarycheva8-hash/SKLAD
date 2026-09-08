import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  ordersTable,
  orderItemsTable,
  clientsTable,
  productsTable,
  shipmentsTable,
  orderPaymentsTable,
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

const router: IRouter = Router();
router.use("/orders", requireSectionAccess("orders"));
const canEditOrders = requirePermission("orders");

router.get("/orders", async (req, res): Promise<void> => {
  const query = ListOrdersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const conditions = [];
  if (query.data.clientId) conditions.push(eq(ordersTable.clientId, query.data.clientId));
  if (query.data.isPaid !== undefined) conditions.push(eq(ordersTable.isPaid, query.data.isPaid));

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

  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, parsed.data.clientId));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
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

  const order = await db.transaction(async (tx) => {
    const [createdOrder] = await tx
      .insert(ordersTable)
      .values({
        clientId: parsed.data.clientId,
        isPaid: false,
        note: parsed.data.note ?? null,
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

    return createdOrder;
  });

  res.status(201).json(CreateOrderResponse.parse(await toOrderDto(order, client.name)));
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

  const updateValues: Record<string, unknown> = {};
  if (parsed.data.note !== undefined) updateValues.note = parsed.data.note;

  const order = await db.transaction(async (tx) => {
    let updatedOrder = existingOrder;
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

    return updatedOrder;
  });

  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, order.clientId));

  res.json(UpdateOrderResponse.parse(await toOrderDto(order, client?.name ?? "")));
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

  const order = await db.transaction(async (tx) => {
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

  const [order] = await db.delete(ordersTable).where(eq(ordersTable.id, params.data.id)).returning();

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
