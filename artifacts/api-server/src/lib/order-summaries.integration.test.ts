import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, clientsTable, sitesTable, productsTable, ordersTable, orderItemsTable,
  deliveriesTable, deliveryPhotosTable, shipmentsTable, orderPaymentsTable,
  orderSummariesTable, orderSummaryMembersTable, orderSummaryItemsTable,
} from "@workspace/db";
import { BillingError, createSummary, paySummary, previewSummary, summaryDto } from "./order-summaries";
import { getOrderLifecycle, isOrderFrozen, deliveryHasFrozenOrder, validFulfillmentDelivery } from "./order-billing";
import { recalculateOrderIsPaid, toOrderDto } from "./orders";
import { isPostgresConstraintError } from "./postgres-errors";

test("development DB: atomic client billing, immutable snapshots and payment propagation", async (t) => {
  if (process.env.ORDER_BILLING_ALLOW_DEVELOPMENT_MUTATIONS !== "1" ||
    !process.env.REPLIT_DEV_DOMAIN || process.env.NODE_ENV === "production") {
    throw new Error("Requires development workspace and ORDER_BILLING_ALLOW_DEVELOPMENT_MUTATIONS=1; never run against production");
  }
  const tag = randomUUID();
  let clientId = "";
  let productId = "";
  let siteId = "";
  let sourceIds: string[] = [];
  try {
    const [client] = await db.insert(clientsTable).values({ name: `Billing test ${tag}` }).returning();
    clientId = client.id;
    const [site] = await db.insert(sitesTable).values({
      name: `Billing site ${tag}`, address: "Test", branch: "Test", client: client.name,
      clientId, manager: "Test", director: "Test", project: "Test",
    }).returning();
    siteId = site.id;
    const [product] = await db.insert(productsTable).values({
      name: `Original name ${tag}`, sku: tag, unit: "шт", price: "999",
    }).returning();
    productId = product.id;
    const sources = await db.insert(ordersTable).values([
      { clientId, siteId, plannedMonth: "2026-09" },
      { clientId, siteId, plannedMonth: "2026-09" },
      { clientId, siteId, plannedMonth: "2026-01" },
      { clientId, siteId, plannedMonth: "2026-01", isPaid: true },
    ]).returning();
    sourceIds = sources.map((s) => s.id);
    const [primary] = await db.insert(deliveriesTable).values({
      siteId, plannedDate: "2026-01-01", scheduleMonth: "2026-01", actualDate: "2026-01-02",
    }).returning();
    const [additional] = await db.insert(deliveriesTable).values({
      siteId, parentDeliveryId: primary.id, orderId: sources[1].id,
      plannedDate: "2026-01-01", scheduleMonth: "2026-01", actualDate: "2026-01-02",
    }).returning();
    await db.update(ordersTable).set({ fulfillmentDeliveryId: primary.id }).where(eq(ordersTable.id, sources[0].id));
    await db.insert(deliveryPhotosTable).values([primary, additional].map((d) => ({
      deliveryId: d.id, objectPath: `/billing-test/${tag}/${d.id}`, uploadedBy: "test",
    })));
    await db.insert(orderItemsTable).values([
      { orderId: sources[0].id, productId, quantity: "2", price: "10" },
      { orderId: sources[1].id, productId, quantity: "1", price: "10" },
      { orderId: sources[1].id, productId, quantity: "3", price: "12" },
      { orderId: sources[2].id, productId, quantity: "5", price: "99" },
    ]);

    const period = { clientId, periodFrom: "2026-01", periodTo: "2026-01" };
    await t.test("invalid/empty/reversed periods and zero matches are explicit", async () => {
      for (const [periodFrom, periodTo] of [["", ""], ["2026-02", "2026-01"]]) {
        await assert.rejects(previewSummary({ clientId, periodFrom, periodTo }),
          (e: unknown) => e instanceof BillingError && e.status === 400);
      }
      await assert.rejects(previewSummary({ clientId, periodFrom: "2025-01", periodTo: "2025-12" }),
        (e: unknown) => e instanceof BillingError && e.status === 409);
      await assert.rejects(createSummary({ clientId, periodFrom: "2025-01", periodTo: "2025-12", requestId: randomUUID() }),
        (e: unknown) => e instanceof BillingError && e.status === 409);
    });
    await t.test("delivery proof without approval and never ambiguous site/date inference", async () => {
      const first = (await db.select().from(ordersTable).where(eq(ordersTable.id, sources[0].id)))[0];
      const ordinaryDto = await toOrderDto(first, client.name);
      const additionalDto = await toOrderDto(sources[1], client.name);
      assert.equal(ordinaryDto.monthFromDelivery, true);
      assert.equal(ordinaryDto.deliveryFromAdditionalOrder, false);
      assert.equal(ordinaryDto.fulfillmentDeliveryId, primary.id);
      assert.equal(additionalDto.monthFromDelivery, true);
      assert.equal(additionalDto.deliveryFromAdditionalOrder, true);
      assert.equal(additionalDto.fulfillmentDeliveryId, additional.id);
      assert.equal((await toOrderDto(sources[2], client.name)).deliveryFromAdditionalOrder, false);
      assert.equal((await getOrderLifecycle(first)).status, "delivered");
      assert.equal((await getOrderLifecycle(sources[1])).fulfillmentDeliveryId, additional.id);
      assert.equal((await getOrderLifecycle(sources[2])).status, "draft");
      await db.update(deliveryPhotosTable).set({ deletionPendingAt: new Date() })
        .where(eq(deliveryPhotosTable.deliveryId, primary.id));
      assert.equal((await getOrderLifecycle(first)).status, "draft");
      await db.update(deliveryPhotosTable).set({ deletionPendingAt: null })
        .where(eq(deliveryPhotosTable.deliveryId, primary.id));
      await db.update(deliveriesTable).set({ archivedAt: new Date() }).where(eq(deliveriesTable.id, primary.id));
      assert.equal((await getOrderLifecycle(first)).status, "draft");
      await db.update(deliveriesTable).set({ archivedAt: null }).where(eq(deliveriesTable.id, primary.id));
      await db.transaction(async (tx) => {
        assert.equal(await validFulfillmentDelivery(primary.id, siteId, tx), true);
        assert.equal(await validFulfillmentDelivery(additional.id, siteId, tx), false);
        assert.equal(await validFulfillmentDelivery(primary.id, randomUUID(), tx), false);
      });
    });
    await t.test("only nondeleted shipment marks an unlinked order shipped", async () => {
      const [shipment] = await db.insert(shipmentsTable).values({
        orderId: sources[2].id, siteId, shipmentDate: "2026-01-01",
      }).returning();
      assert.equal((await getOrderLifecycle(sources[2])).status, "shipped");
      await db.update(shipmentsTable).set({ isDeleted: true }).where(eq(shipmentsTable.id, shipment.id));
      assert.equal((await getOrderLifecycle(sources[2])).status, "draft");
    });
    await t.test("all non-delivered and legacy paid sources block entire request, with identities", async () => {
      const preview = await previewSummary(period);
      assert.deepEqual(new Set(preview.orders.map((o) => o.id)), new Set(sourceIds.slice(0, 2)));
      assert.deepEqual(new Set(preview.blockers.map((o) => o.status)), new Set(["draft", "paid"]));
      assert(preview.blockers.every((o) => o.number && o.reason));
      assert.deepEqual(preview.items.map((i) => [i.quantity, i.price, i.total]), [[3, 10, 30], [3, 12, 36]]);
      assert.equal(preview.totalAmount, 66);
      await assert.rejects(createSummary({ ...period, requestId: randomUUID() }),
        (e: unknown) => e instanceof BillingError && e.status === 409 && e.blockers.length === 2);
      assert.equal((await db.select().from(orderSummariesTable).where(eq(orderSummariesTable.clientId, clientId))).length, 0);
      assert.equal((await db.select().from(orderSummaryMembersTable).where(inArray(orderSummaryMembersTable.orderId, sourceIds))).length, 0);
    });
    // Move blockers outside this test's billing period using fixture-only DML.
    await db.update(ordersTable).set({ plannedMonth: "2026-02" }).where(inArray(ordersTable.id, sourceIds.slice(2)));
    const requestId = randomUUID();
    const [created, retried] = await Promise.all([
      createSummary({ ...period, requestId }), createSummary({ ...period, requestId }),
    ]);
    await t.test("concurrent duplicate submissions return same summary; billed orders remain explicit blockers", async () => {
      assert.equal(created.id, retried.id);
      assert.match(created.number, /^СЗ-[0-9]+$/);
      assert.equal(created.status, "awaiting_payment");
      assert.equal(created.totalAmount, 66);
      assert.equal(created.orders.length, 2);
      assert.equal(await isOrderFrozen(sources[0].id), true);
      assert.equal(await deliveryHasFrozenOrder(primary.id, db), true);
      assert.equal((await previewSummary(period)).blockers.length, 2);
      await assert.rejects(createSummary({ ...period, requestId: randomUUID() }),
        (e: unknown) => e instanceof BillingError && e.status === 409);
      await assert.rejects(createSummary({ ...period, periodTo: "2026-02", requestId }),
        (e: unknown) => e instanceof BillingError && e.status === 400);
      assert.equal((await db.select().from(orderSummariesTable).where(eq(orderSummariesTable.clientId, clientId))).length, 1);
      await assert.rejects(db.insert(orderSummaryMembersTable).values({
        summaryId: created.id, orderId: sources[0].id, orderNumber: created.orders[0].number,
      }), (e: unknown) => isPostgresConstraintError(e, { code: "23505", constraint: "order_summary_members_order_uq" }));
    });
    await t.test("immutable names/unit/original prices survive catalogue changes", async () => {
      await db.update(productsTable).set({ name: `Changed ${tag}`, unit: "кг", price: "2000" }).where(eq(productsTable.id, productId));
      const [stored] = await db.select().from(orderSummariesTable).where(eq(orderSummariesTable.id, created.id));
      const dto = await summaryDto(stored);
      assert(dto.items.every((i) => i.productName === product.name && i.unit === "шт"));
      assert.deepEqual(dto.items.map((i) => i.price), [10, 12]);
      assert.equal(dto.totalAmount, 66);
    });
    await t.test("payment is atomic/idempotent, propagates isPaid without fabricated payments", async () => {
      const [paid, again] = await Promise.all([paySummary(created.id), paySummary(created.id)]);
      assert.equal(paid.status, "paid");
      assert.equal(paid.paidAt?.getTime(), again.paidAt?.getTime());
      const linked = await db.select().from(ordersTable).where(inArray(ordersTable.id, sourceIds.slice(0, 2)));
      assert(linked.every((o) => o.isPaid));
      for (const order of linked) assert.equal((await getOrderLifecycle(order)).status, "paid");
      assert.equal((await db.select().from(orderPaymentsTable).where(inArray(orderPaymentsTable.orderId, sourceIds))).length, 0);
      await db.transaction(async (tx) => {
        assert.equal((await recalculateOrderIsPaid(sources[0].id, 20, tx)).isPaid, true);
        assert.equal((await recalculateOrderIsPaid(sources[3].id, 100, tx)).isPaid, true);
      });
    });
  } finally {
    if (clientId) {
      const summaries = await db.select().from(orderSummariesTable).where(eq(orderSummariesTable.clientId, clientId));
      const ids = summaries.map((s) => s.id);
      if (ids.length) {
        await db.delete(orderSummaryItemsTable).where(inArray(orderSummaryItemsTable.summaryId, ids));
        await db.delete(orderSummaryMembersTable).where(inArray(orderSummaryMembersTable.summaryId, ids));
        await db.delete(orderSummariesTable).where(inArray(orderSummariesTable.id, ids));
      }
      await db.update(ordersTable).set({ fulfillmentDeliveryId: null }).where(eq(ordersTable.clientId, clientId));
      if (siteId) {
        // Child deliveries must be removed before self-referencing parents.
        const deliveries = await db.select().from(deliveriesTable).where(eq(deliveriesTable.siteId, siteId));
        for (const d of deliveries.filter((d) => d.parentDeliveryId)) await db.delete(deliveriesTable).where(eq(deliveriesTable.id, d.id));
        await db.delete(deliveriesTable).where(eq(deliveriesTable.siteId, siteId));
      }
      if (sourceIds.length) await db.delete(shipmentsTable).where(inArray(shipmentsTable.orderId, sourceIds));
      await db.delete(ordersTable).where(eq(ordersTable.clientId, clientId));
      if (siteId) await db.delete(sitesTable).where(eq(sitesTable.id, siteId));
      await db.delete(clientsTable).where(eq(clientsTable.id, clientId));
    }
    if (productId) await db.delete(productsTable).where(eq(productsTable.id, productId));
    await pool.end();
  }
});