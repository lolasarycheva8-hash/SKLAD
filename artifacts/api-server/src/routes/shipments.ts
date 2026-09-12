import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  ordersTable,
  orderItemsTable,
  sitesTable,
  shipmentsTable,
  shipmentItemsTable,
  movementsTable,
} from "@workspace/db";
import {
  ListShipmentsQueryParams,
  CreateShipmentBody,
  GetShipmentParams,
  UpdateShipmentParams,
  UpdateShipmentBody,
  DispatchShipmentParams,
  DeleteShipmentParams,
  DeleteShipmentBody,
  ListShipmentsResponse,
  CreateShipmentResponse,
  GetShipmentResponse,
  UpdateShipmentResponse,
  DispatchShipmentResponse,
  DeleteShipmentResponse,
} from "@workspace/api-zod";
import { toShipmentDto } from "../lib/shipments";
import { getShippedQuantityMap } from "../lib/orders";
import { requirePermission, requireAdmin, requireSectionAccess } from "../middlewares/requirePermission";
import { findInvalidDriverUserIds } from "../lib/drivers";
import { isPostgresConstraintError } from "../lib/postgres-errors";

const router: IRouter = Router();
router.use("/shipments", requireSectionAccess("shipments"));
const canEditShipments = requirePermission("shipments");

router.get("/shipments", async (req, res): Promise<void> => {
  const query = ListShipmentsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const conditions = [];
  if (query.data.orderId) conditions.push(eq(shipmentsTable.orderId, query.data.orderId));
  if (query.data.siteId) conditions.push(eq(shipmentsTable.siteId, query.data.siteId));

  const rows = await db
    .select()
    .from(shipmentsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(shipmentsTable.createdAt);

  const dtos = await Promise.all(rows.map((row) => toShipmentDto(row)));

  res.json(ListShipmentsResponse.parse(dtos));
});

router.post("/shipments", canEditShipments, async (req, res): Promise<void> => {
  const parsed = CreateShipmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, parsed.data.orderId));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  if (!order.isPaid) {
    res.status(400).json({ error: "Нельзя отгружать по неоплаченному заказу" });
    return;
  }

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, parsed.data.siteId));
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  if ((await findInvalidDriverUserIds([parsed.data.driverUserId])).length > 0) {
    res.status(400).json({ error: "Выбранный пользователь не является водителем" });
    return;
  }

  let validationError: string | null = null;

  let shipment;
  try {
    shipment = await db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from ${ordersTable} where ${ordersTable.id} = ${order.id} for update`);

      const orderItems = await tx
        .select()
        .from(orderItemsTable)
        .where(eq(orderItemsTable.orderId, order.id));
      const orderQuantityMap = new Map<string, number>();
      for (const oi of orderItems) {
        orderQuantityMap.set(oi.productId, (orderQuantityMap.get(oi.productId) ?? 0) + Number(oi.quantity));
      }

      const productIds = [...new Set(parsed.data.items.map((item) => item.productId))];
      const missingInOrder = productIds.filter((id) => !orderQuantityMap.has(id));
      if (missingInOrder.length > 0) {
        validationError = `Товары отсутствуют в заказе: ${missingInOrder.join(", ")}`;
        tx.rollback();
      }

      const shippedMap = await getShippedQuantityMap(order.id, tx);

      const requestedQuantityMap = new Map<string, number>();
      for (const item of parsed.data.items) {
        requestedQuantityMap.set(item.productId, (requestedQuantityMap.get(item.productId) ?? 0) + item.quantity);
      }

      for (const [productId, requestedQuantity] of requestedQuantityMap) {
        const ordered = orderQuantityMap.get(productId) ?? 0;
        const alreadyShipped = shippedMap.get(productId) ?? 0;
        const remaining = ordered - alreadyShipped;
        if (requestedQuantity > remaining) {
          validationError = `Нельзя отгрузить больше заказанного (товар ${productId}): остаток ${remaining}`;
          tx.rollback();
        }
      }

      const [createdShipment] = await tx
        .insert(shipmentsTable)
        .values({
          orderId: parsed.data.orderId,
          siteId: parsed.data.siteId,
          driverUserId: parsed.data.driverUserId ?? null,
          shipmentDate: parsed.data.shipmentDate.toISOString().slice(0, 10),
          note: parsed.data.note ?? null,
        })
        .returning();

      await tx.insert(shipmentItemsTable).values(
        parsed.data.items.map((item) => ({
          shipmentId: createdShipment.id,
          productId: item.productId,
          quantity: String(item.quantity),
        })),
      );

      await tx.insert(movementsTable).values(
        parsed.data.items.map((item) => ({
          productId: item.productId,
          type: "out" as const,
          quantity: String(item.quantity),
          reason: `Отгрузка по заказу №${order.id.slice(0, 8)} (объект: ${site.name})`,
          note: parsed.data.note ?? null,
          shipmentId: createdShipment.id,
        })),
      );

      return createdShipment;
    });
  } catch (err) {
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }
    if (
      isPostgresConstraintError(err, {
        code: "23503",
        constraint: "shipments_driver_user_id_app_users_id_fk",
      })
    ) {
      res.status(400).json({ error: "Выбранный пользователь не является водителем" });
      return;
    }
    throw err;
  }

  res.status(201).json(CreateShipmentResponse.parse(await toShipmentDto(shipment)));
});

router.get("/shipments/:id", async (req, res): Promise<void> => {
  const params = GetShipmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [shipment] = await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, params.data.id));

  if (!shipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }

  res.json(GetShipmentResponse.parse(await toShipmentDto(shipment)));
});

router.patch("/shipments/:id", canEditShipments, async (req, res): Promise<void> => {
  const params = UpdateShipmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateShipmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existingShipment] = await db
    .select()
    .from(shipmentsTable)
    .where(eq(shipmentsTable.id, params.data.id));
  if (!existingShipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }

  if (existingShipment.isDeleted) {
    res.status(400).json({ error: "Отгрузка помечена на удаление, редактирование недоступно" });
    return;
  }

  if (existingShipment.isDispatched) {
    res.status(400).json({ error: "Отгрузка передана курьеру, редактирование недоступно" });
    return;
  }

  if (parsed.data.siteId) {
    const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, parsed.data.siteId));
    if (!site) {
      res.status(404).json({ error: "Site not found" });
      return;
    }
  }
  if (
    parsed.data.driverUserId !== undefined &&
    (await findInvalidDriverUserIds([parsed.data.driverUserId])).length > 0
  ) {
    res.status(400).json({ error: "Выбранный пользователь не является водителем" });
    return;
  }

  const updateValues: Record<string, unknown> = {};
  if (parsed.data.siteId !== undefined) updateValues.siteId = parsed.data.siteId;
  if (parsed.data.driverUserId !== undefined) updateValues.driverUserId = parsed.data.driverUserId;
  if (parsed.data.shipmentDate !== undefined) {
    updateValues.shipmentDate = parsed.data.shipmentDate.toISOString().slice(0, 10);
  }
  if (parsed.data.note !== undefined) updateValues.note = parsed.data.note;

  let validationError: string | null = null;

  let shipment;
  try {
    shipment = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select 1 from ${ordersTable} where ${ordersTable.id} = ${existingShipment.orderId} for update`,
      );

      if (parsed.data.items) {
        const orderItems = await tx
          .select()
          .from(orderItemsTable)
          .where(eq(orderItemsTable.orderId, existingShipment.orderId));
        const orderQuantityMap = new Map<string, number>();
        for (const oi of orderItems) {
          orderQuantityMap.set(oi.productId, (orderQuantityMap.get(oi.productId) ?? 0) + Number(oi.quantity));
        }

        const productIds = [...new Set(parsed.data.items.map((item) => item.productId))];
        const missingInOrder = productIds.filter((id) => !orderQuantityMap.has(id));
        if (missingInOrder.length > 0) {
          validationError = `Товары отсутствуют в заказе: ${missingInOrder.join(", ")}`;
          tx.rollback();
        }

        const shippedMap = await getShippedQuantityMap(existingShipment.orderId, tx, existingShipment.id);

        const requestedQuantityMap = new Map<string, number>();
        for (const item of parsed.data.items) {
          requestedQuantityMap.set(item.productId, (requestedQuantityMap.get(item.productId) ?? 0) + item.quantity);
        }

        for (const [productId, requestedQuantity] of requestedQuantityMap) {
          const ordered = orderQuantityMap.get(productId) ?? 0;
          const alreadyShippedElsewhere = shippedMap.get(productId) ?? 0;
          const remaining = ordered - alreadyShippedElsewhere;
          if (requestedQuantity > remaining) {
            validationError = `Нельзя отгрузить больше заказанного (товар ${productId}): остаток ${remaining}`;
            tx.rollback();
          }
        }
      }

      const [updatedShipment] = await tx
        .update(shipmentsTable)
        .set(Object.keys(updateValues).length > 0 ? updateValues : { note: existingShipment.note })
        .where(eq(shipmentsTable.id, params.data.id))
        .returning();

      if (parsed.data.items) {
        const [site] = await tx
          .select()
          .from(sitesTable)
          .where(eq(sitesTable.id, updatedShipment.siteId));

        await tx.delete(shipmentItemsTable).where(eq(shipmentItemsTable.shipmentId, updatedShipment.id));
        await tx.delete(movementsTable).where(eq(movementsTable.shipmentId, updatedShipment.id));

        await tx.insert(shipmentItemsTable).values(
          parsed.data.items.map((item) => ({
            shipmentId: updatedShipment.id,
            productId: item.productId,
            quantity: String(item.quantity),
          })),
        );

        await tx.insert(movementsTable).values(
          parsed.data.items.map((item) => ({
            productId: item.productId,
            type: "out" as const,
            quantity: String(item.quantity),
            reason: `Отгрузка по заказу №${existingShipment.orderId.slice(0, 8)} (объект: ${site?.name ?? ""})`,
            note: updatedShipment.note ?? null,
            shipmentId: updatedShipment.id,
          })),
        );
      }

      return updatedShipment;
    });
  } catch (err) {
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }
    if (
      isPostgresConstraintError(err, {
        code: "23503",
        constraint: "shipments_driver_user_id_app_users_id_fk",
      })
    ) {
      res.status(400).json({ error: "Выбранный пользователь не является водителем" });
      return;
    }
    throw err;
  }

  res.json(UpdateShipmentResponse.parse(await toShipmentDto(shipment)));
});

router.post("/shipments/:id/dispatch", canEditShipments, async (req, res): Promise<void> => {
  const params = DispatchShipmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existingShipment] = await db
    .select()
    .from(shipmentsTable)
    .where(eq(shipmentsTable.id, params.data.id));
  if (!existingShipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }

  if (existingShipment.isDeleted) {
    res.status(400).json({ error: "Отгрузка помечена на удаление" });
    return;
  }

  if (existingShipment.isDispatched) {
    res.status(400).json({ error: "Отгрузка уже передана курьеру" });
    return;
  }

  const [shipment] = await db
    .update(shipmentsTable)
    .set({ isDispatched: true, dispatchedAt: new Date() })
    .where(eq(shipmentsTable.id, params.data.id))
    .returning();

  res.json(DispatchShipmentResponse.parse(await toShipmentDto(shipment)));
});

router.post("/shipments/:id/delete", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteShipmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = DeleteShipmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existingShipment] = await db
    .select()
    .from(shipmentsTable)
    .where(eq(shipmentsTable.id, params.data.id));
  if (!existingShipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }

  if (existingShipment.isDeleted) {
    res.status(400).json({ error: "Отгрузка уже помечена на удаление" });
    return;
  }

  const shipment = await db.transaction(async (tx) => {
    const items = await tx
      .select()
      .from(shipmentItemsTable)
      .where(eq(shipmentItemsTable.shipmentId, existingShipment.id));

    if (items.length > 0) {
      await tx.insert(movementsTable).values(
        items.map((item) => ({
          productId: item.productId,
          type: "in" as const,
          quantity: item.quantity,
          reason: `Отмена отгрузки №${existingShipment.id.slice(0, 8)} (возврат на склад)`,
          note: parsed.data.note,
          shipmentId: existingShipment.id,
        })),
      );
    }

    const [updatedShipment] = await tx
      .update(shipmentsTable)
      .set({ isDeleted: true, deletedAt: new Date(), deleteNote: parsed.data.note })
      .where(eq(shipmentsTable.id, existingShipment.id))
      .returning();

    return updatedShipment;
  });

  res.json(DeleteShipmentResponse.parse(await toShipmentDto(shipment)));
});

export default router;
