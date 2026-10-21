import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import {
  clientsTable,
  db,
  deliveriesTable,
  orderItemsTable,
  ordersTable,
  pool,
  productsTable,
  sitesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import express from "express";

import type { AuthenticatedAppUser } from "./user-roles.ts";
import lookupsRouter from "../routes/lookups.ts";
import ordersRouter from "../routes/orders.ts";

const fixtureId = randomUUID();
const clientName = `Клиент заказов ${fixtureId}`;
let clientId = "";
let otherClientId = "";
let siteId = "";
let alternateSiteId = "";
let otherSiteId = "";
let productId = "";
let baseUrl = "";

const now = new Date();
const logistician: AuthenticatedAppUser = {
  id: randomUUID(),
  clerkUserId: `orders-sites-${fixtureId}`,
  email: `orders-sites-${fixtureId}@example.test`,
  name: "Логист без доступа к доставкам",
  phone: null,
  role: "logistician",
  editableSections: [],
  isDriver: false,
  assignedSiteIds: null,
  createdAt: now,
  updatedAt: now,
};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.appUser = logistician;
  req.log = { error() {}, info() {}, warn() {} } as unknown as typeof req.log;
  next();
});
app.use(lookupsRouter);
app.use(ordersRouter);

let server: ReturnType<typeof app.listen>;

before(async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Integration tests must not run against production");
  }
  const clients = await db
    .insert(clientsTable)
    .values([
      { name: clientName },
      { name: `Другой клиент заказов ${fixtureId}` },
    ])
    .returning({ id: clientsTable.id });
  clientId = clients[0].id;
  otherClientId = clients[1].id;

  const sites = await db
    .insert(sitesTable)
    .values([
      {
        name: `Магазин заказов ${fixtureId}`,
        address: "Москва, Тестовая улица, 1",
        branch: "Тест",
        client: clientName,
        clientId,
        manager: "Менеджер",
        director: "Директор",
        project: "Проект",
      },
      {
        name: `Второй магазин заказов ${fixtureId}`,
        address: "Москва, Тестовая улица, 3",
        branch: "Тест",
        client: clientName,
        clientId,
        manager: "Менеджер",
        director: "Директор",
        project: "Проект",
      },
      {
        name: `Чужой магазин заказов ${fixtureId}`,
        address: "Москва, Тестовая улица, 2",
        branch: "Тест",
        client: `Другой клиент заказов ${fixtureId}`,
        clientId: otherClientId,
        manager: "Менеджер",
        director: "Директор",
        project: "Проект",
      },
    ])
    .returning({ id: sitesTable.id });
  siteId = sites[0].id;
  alternateSiteId = sites[1].id;
  otherSiteId = sites[2].id;

  const [product] = await db
    .insert(productsTable)
    .values({
      name: `Товар заказов ${fixtureId}`,
      sku: `order-sites-${fixtureId}`,
      unit: "шт",
      price: "100",
    })
    .returning({ id: productsTable.id });
  productId = product.id;

  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) =>
      error ? reject(error) : resolve(),
    );
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await db
    .delete(deliveriesTable)
    .where(
      inArray(deliveriesTable.siteId, [
        siteId,
        alternateSiteId,
        otherSiteId,
      ]),
    );
  const fixtureOrders = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(inArray(ordersTable.clientId, [clientId, otherClientId]));
  const orderIds = fixtureOrders.map((order) => order.id);
  if (orderIds.length > 0) {
    await db.delete(orderItemsTable).where(inArray(orderItemsTable.orderId, orderIds));
    await db.delete(ordersTable).where(inArray(ordersTable.id, orderIds));
  }
  await db
    .delete(sitesTable)
    .where(inArray(sitesTable.id, [siteId, alternateSiteId, otherSiteId]));
  await db.delete(productsTable).where(eq(productsTable.id, productId));
  await db.delete(clientsTable).where(inArray(clientsTable.id, [clientId, otherClientId]));
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await pool.end();
});

test("логист без доступа к доставкам получает только привязанные к клиентам магазины", async () => {
  const response = await fetch(`${baseUrl}/lookups/order-sites`);
  assert.equal(response.status, 200);
  const rows = (await response.json()) as Array<{
    id: string;
    name: string;
    address: string;
    clientId: string;
  }>;
  assert.deepEqual(
    rows.find((row) => row.id === siteId),
    {
      id: siteId,
      name: `Магазин заказов ${fixtureId}`,
      address: "Москва, Тестовая улица, 1",
      clientId,
    },
  );
});

test("создание заказа требует действительную дату и атомарно создаёт независимую доставку", async () => {
  const payload = {
    clientId, siteId, plannedMonth: "2029-02", plannedDeliveryDate: "2029-02-10",
    items: [{ productId, quantity: 1, price: 100 }],
  };
  const create = (changes: object) => fetch(`${baseUrl}/orders`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, ...changes }),
  });
  const beforeOrders = await db.select().from(ordersTable).where(eq(ordersTable.clientId, clientId));
  for (const changes of [
    { plannedDeliveryDate: undefined }, { plannedDeliveryDate: "" },
    { plannedDeliveryDate: "2029-02-30" }, { plannedDeliveryDate: "2029-03-10" },
    { siteId: null }, { fulfillmentDeliveryId: randomUUID() },
  ]) {
    assert.equal((await create(changes)).status, 400);
  }
  assert.equal((await db.select().from(ordersTable).where(eq(ordersTable.clientId, clientId))).length, beforeOrders.length);
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const response = await create({});
    assert.equal(response.status, 201);
    const order = await response.json() as { id: string; fulfillmentDeliveryId: string; plannedMonth: string };
    ids.push(order.fulfillmentDeliveryId);
    const rows = await db.select().from(deliveriesTable).where(eq(deliveriesTable.orderId, order.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, order.fulfillmentDeliveryId);
    assert.equal(rows[0].plannedDate, payload.plannedDeliveryDate);
    assert.equal(rows[0].scheduleMonth, payload.plannedMonth);
    assert.equal(rows[0].siteId, siteId);
    assert.equal(rows[0].parentDeliveryId, null);
    assert.equal(rows[0].deliveryType, "доп.заказ");
    assert.equal(rows[0].actualDate, null);
    assert.equal(rows[0].actApprovedAt, null);
  }
  assert.notEqual(ids[0], ids[1]);
});

test("заказ требует месяц при создании и копировании, запрещает очистку и сохраняет исторические заказы без месяца", async () => {
  const request = (path: string, method = "GET", data?: object) => fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
  const create = (plannedMonth?: string | null) => request("/orders", "POST", {
    clientId, siteId, ...(plannedMonth === undefined ? {} : { plannedMonth }),
    plannedDeliveryDate: `${plannedMonth}-10`,
    items: [{ productId, quantity: 1, price: 100 }],
  });
  for (const value of [undefined, null, "", "2027-00", "2027-13", "2027-2", "02/2027", "2027-02-01"]) {
    assert.equal((await create(value)).status, 400, `create plannedMonth=${String(value)}`);
  }
  // Only historical database records may lack a month; the create API must not produce them.
  const [legacyOrder] = await db.insert(ordersTable).values({ clientId, plannedMonth: null }).returning();
  const oldResponse = await request(`/orders/${legacyOrder.id}`);
  assert.equal(oldResponse.status, 200);
  const old = await oldResponse.json() as { id: string; plannedMonth: string | null; monthFromDelivery: boolean };
  assert.equal(old.plannedMonth, null);
  assert.equal(old.monthFromDelivery, false);
  assert.equal((await create(old.plannedMonth)).status, 400);
  assert.equal((await request(`/orders/${old.id}`, "PATCH", { plannedMonth: null })).status, 400);
  assert.equal((await request(`/orders/${old.id}`, "PATCH", { note: "Исторический заказ" })).status, 200);
  assert.equal(((await (await request(`/orders/${old.id}`)).json()) as typeof old).plannedMonth, null);
  const newResponse = await create("2027-02");
  assert.equal(newResponse.status, 201);
  const fresh = await newResponse.json() as typeof old;
  assert.equal(fresh.plannedMonth, "2027-02");
  const copyResponse = await create(fresh.plannedMonth);
  assert.equal(copyResponse.status, 201);
  const copy = await copyResponse.json() as typeof old;
  assert.equal(copy.plannedMonth, "2027-02");
  assert.equal((await request(`/orders/${copy.id}`, "PATCH", { plannedMonth: "2027-03" })).status, 400);
  // Linked orders follow a date change in the delivery schedule, not an independent month edit.
  await db.update(deliveriesTable).set({ plannedDate: "2027-03-10", scheduleMonth: "2027-03" })
    .where(eq(deliveriesTable.orderId, copy.id));
  assert.equal(((await (await request(`/orders/${copy.id}`)).json()) as typeof old).plannedMonth, "2027-03");
  for (const value of [null, "", "2027-00", "2027-13", "2027-2", "02/2027"]) {
    assert.equal((await request(`/orders/${copy.id}`, "PATCH", { plannedMonth: value })).status, 400);
  }
  assert.equal(((await (await request(`/orders/${copy.id}`)).json()) as typeof old).plannedMonth, "2027-03");
  assert.equal((await request(`/orders/${copy.id}`, "PATCH", { note: "Без изменения месяца" })).status, 200);
  assert.equal(((await (await request(`/orders/${copy.id}`)).json()) as typeof old).plannedMonth, "2027-03");
  for (const value of ["2027-00", "2027-13", "2027-2", "02/2027"]) {
    assert.equal((await create(value)).status, 400);
    assert.equal((await request(`/orders?plannedMonth=${encodeURIComponent(value)}`)).status, 400);
  }
  assert.equal((await request("/orders?plannedMonth=2027-02&plannedMonth=2027-03")).status, 400);
  const monthList = await (await request(`/orders?clientId=${clientId}&plannedMonth=2027-02`)).json() as typeof old[];
  assert.deepEqual(monthList.map((row) => row.id), [fresh.id]);
  const copiedMonthList = await (await request(`/orders?clientId=${clientId}&plannedMonth=2027-03`)).json() as typeof old[];
  assert.deepEqual(copiedMonthList.map((row) => row.id), [copy.id]);
  const missingList = await (await request(`/orders?clientId=${clientId}&plannedMonth=without`)).json() as typeof old[];
  assert(missingList.some((row) => row.id === old.id));

  await db.update(deliveriesTable).set({
    plannedDate: "2027-04-21", correctedPlannedDate: "2027-06-21",
    scheduleMonth: "2027-05",
  }).where(eq(deliveriesTable.orderId, fresh.id));
  const linked = await (await request(`/orders/${fresh.id}`)).json() as typeof old;
  assert.equal(linked.plannedMonth, "2027-04");
  assert.equal(linked.monthFromDelivery, true);
  assert.equal((await request(`/orders/${fresh.id}`, "PATCH", { plannedMonth: "2027-05" })).status, 400);
  assert.equal((await request(`/orders/${fresh.id}`, "PATCH", { plannedMonth: null })).status, 400);
  assert.equal((await request(`/orders/${fresh.id}`, "PATCH", { plannedMonth: "2027-04" })).status, 200);
  const linkedMonth = await (await request(`/orders?clientId=${clientId}&plannedMonth=2027-04`)).json() as typeof old[];
  assert(linkedMonth.some((row) => row.id === fresh.id));
  const persisted = await db.select().from(deliveriesTable).where(eq(deliveriesTable.orderId, fresh.id));
  assert.equal(persisted[0].correctedPlannedDate, "2027-06-21");
  assert.equal(persisted[0].plannedDate, "2027-04-21");
  await db.update(deliveriesTable).set({ plannedDate: "2028-01-12" })
    .where(eq(deliveriesTable.orderId, fresh.id));
  assert.equal(((await (await request(`/orders/${fresh.id}`)).json()) as typeof old).plannedMonth, "2028-01");
  const futureMonth = await (await request(`/orders?clientId=${clientId}&plannedMonth=2028-01`)).json() as typeof old[];
  assert(futureMonth.some((row) => row.id === fresh.id));
  assert.equal((await request(`/orders/${fresh.id}`, "PATCH", { plannedMonth: "2027-04" })).status, 400);

  await db.insert(deliveriesTable).values({ siteId, orderId: old.id, plannedDate: null, scheduleMonth: "2027-09" });
  assert.equal(((await (await request(`/orders/${old.id}`)).json()) as typeof old).plannedMonth, "2027-09");
  const undatedMonth = await (await request(`/orders?clientId=${clientId}&plannedMonth=2027-09`)).json() as typeof old[];
  assert(undatedMonth.some((row) => row.id === old.id));
});

test("заказ проверяет принадлежность магазина и сохраняет снимок адреса", async () => {
  const mismatch = await fetch(`${baseUrl}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId,
      siteId: otherSiteId,
      plannedMonth: "2027-02",
      plannedDeliveryDate: "2027-02-10",
      items: [{ productId, quantity: 2, price: 100 }],
    }),
  });
  assert.equal(mismatch.status, 400);
  assert.deepEqual(await mismatch.json(), {
    error: "Выбранный магазин не принадлежит указанному юридическому лицу",
  });

  const missing = await fetch(`${baseUrl}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId,
      siteId: randomUUID(),
      plannedMonth: "2027-02",
      plannedDeliveryDate: "2027-02-10",
      items: [{ productId, quantity: 2, price: 100 }],
    }),
  });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {
    error: "Выбранный магазин не найден",
  });

  const created = await fetch(`${baseUrl}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId,
      siteId,
      plannedMonth: "2027-02",
      plannedDeliveryDate: "2027-02-10",
      items: [{ productId, quantity: 2, price: 100 }],
    }),
  });
  assert.equal(created.status, 201);
  const order = (await created.json()) as {
    id: string;
    siteId: string | null;
    siteName: string | null;
    siteAddress: string | null;
  };
  assert.equal(order.siteId, siteId);
  assert.equal(order.siteName, `Магазин заказов ${fixtureId}`);
  assert.equal(order.siteAddress, "Москва, Тестовая улица, 1");

  await db
    .update(sitesTable)
    .set({
      name: `Переименованный магазин ${fixtureId}`,
      address: "Москва, Новый адрес, 5",
    })
    .where(eq(sitesTable.id, siteId));
  const fetched = await fetch(`${baseUrl}/orders/${order.id}`);
  assert.equal(fetched.status, 200);
  const persisted = (await fetched.json()) as typeof order;
  assert.equal(persisted.siteName, `Магазин заказов ${fixtureId}`);
  assert.equal(persisted.siteAddress, "Москва, Тестовая улица, 1");

  const deletionProofResponse = await fetch(`${baseUrl}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: otherClientId,
      siteId: otherSiteId,
      plannedMonth: "2027-02",
      plannedDeliveryDate: "2027-02-10",
      items: [{ productId, quantity: 1, price: 100 }],
    }),
  });
  assert.equal(deletionProofResponse.status, 201);
  const deletionProof = (await deletionProofResponse.json()) as typeof order;
  // Historical unlinked orders retain their destination snapshot after site deletion.
  await db.delete(deliveriesTable).where(eq(deliveriesTable.orderId, deletionProof.id));
  await db.delete(sitesTable).where(eq(sitesTable.id, otherSiteId));
  const afterDeletionResponse = await fetch(
    `${baseUrl}/orders/${deletionProof.id}`,
  );
  assert.equal(afterDeletionResponse.status, 200);
  const afterDeletion = (await afterDeletionResponse.json()) as typeof order;
  assert.equal(afterDeletion.siteId, null);
  assert.equal(
    afterDeletion.siteName,
    `Чужой магазин заказов ${fixtureId}`,
  );
  assert.equal(afterDeletion.siteAddress, "Москва, Тестовая улица, 2");
});

test("старый заказ остаётся без магазина, а связанный с доставкой нельзя направить в другой", async () => {
  const [legacyOrder] = await db
    .insert(ordersTable)
    .values({ clientId })
    .returning();
  const legacyResponse = await fetch(`${baseUrl}/orders/${legacyOrder.id}`);
  assert.equal(legacyResponse.status, 200);
  const legacy = (await legacyResponse.json()) as {
    siteId: string | null;
    siteName: string | null;
    siteAddress: string | null;
  };
  assert.equal(legacy.siteId, null);
  assert.equal(legacy.siteName, null);
  assert.equal(legacy.siteAddress, null);

  await db.insert(deliveriesTable).values({
    siteId,
    orderId: legacyOrder.id,
  });
  const inconsistent = await fetch(`${baseUrl}/orders/${legacyOrder.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ siteId: alternateSiteId }),
  });
  assert.equal(inconsistent.status, 400);
  assert.deepEqual(await inconsistent.json(), {
    error:
      "Нельзя изменить магазин заказа: он не совпадает с магазином связанной доставки",
  });

  const clearing = await fetch(`${baseUrl}/orders/${legacyOrder.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ siteId: null }),
  });
  assert.equal(clearing.status, 400);
  assert.deepEqual(await clearing.json(), {
    error:
      "Нельзя изменить магазин заказа: он не совпадает с магазином связанной доставки",
  });
});