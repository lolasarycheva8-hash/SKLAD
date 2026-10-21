import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import {
  appUsersTable,
  clientsTable,
  db,
  deliveriesTable,
  pool,
  sitesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import express from "express";

import deliveriesRouter from "../routes/deliveries.ts";
import type { AuthenticatedAppUser } from "./user-roles.ts";

function user(
  role: AuthenticatedAppUser["role"],
  editableSections: AuthenticatedAppUser["editableSections"] = [],
): AuthenticatedAppUser {
  const now = new Date();
  return {
    id: randomUUID(),
    clerkUserId: `bulk-update-${randomUUID()}`,
    email: `${randomUUID()}@example.test`,
    name: "Тестовый пользователь",
    phone: null,
    role,
    editableSections,
    isDriver: role === "driver",
    assignedSiteIds: null,
    createdAt: now,
    updatedAt: now,
  };
}

const editor = user("logistician", ["deliveries"]);
const readonlyUser = user("logistician");
const firstDriver = user("driver");
const secondDriver = user("driver");
let actor = editor;
let baseUrl = "";
let clientId = "";
let siteId = "";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.appUser = actor;
  req.log = { error() {}, info() {} } as unknown as typeof req.log;
  next();
});
app.use(deliveriesRouter);
const server = app.listen(0);

before(async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Integration tests must not run against production");
  }
  await db
    .insert(appUsersTable)
    .values([editor, readonlyUser, firstDriver, secondDriver]);
  const clientName = `Bulk update ${randomUUID()}`;
  const [client] = await db
    .insert(clientsTable)
    .values({ name: clientName })
    .returning({ id: clientsTable.id });
  clientId = client.id;
  const [site] = await db
    .insert(sitesTable)
    .values({
      name: `Bulk update ${randomUUID()}`,
      address: "Тестовый адрес",
      branch: "Тестовый куст",
      client: clientName,
      clientId,
      manager: "Менеджер",
      director: "Директор",
      project: "Проект",
      driverUserId: firstDriver.id,
    })
    .returning({ id: sitesTable.id });
  siteId = site.id;
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (siteId) {
    await db.delete(deliveriesTable).where(eq(deliveriesTable.siteId, siteId));
    await db.delete(sitesTable).where(eq(sitesTable.id, siteId));
  }
  if (clientId) {
    await db.delete(clientsTable).where(eq(clientsTable.id, clientId));
  }
  for (const appUser of [editor, readonlyUser, firstDriver, secondDriver]) {
    await db.delete(appUsersTable).where(eq(appUsersTable.id, appUser.id));
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await pool.end();
});

async function createDelivery(
  values: Partial<typeof deliveriesTable.$inferInsert> & {
    plannedDate: string | null;
    scheduleMonth: string;
  },
) {
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: firstDriver.id,
      ...values,
    })
    .returning();
  return delivery;
}

async function update(body: unknown) {
  return fetch(`${baseUrl}/deliveries/bulk/update`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function snapshot(
  delivery: typeof deliveriesTable.$inferSelect,
  overrides: Partial<{
    expectedDriverUserId: string | null;
    expectedPlannedDate: string | null;
  }> = {},
) {
  return {
    id: delivery.id,
    expectedDriverUserId: delivery.driverUserId,
    expectedPlannedDate: delivery.plannedDate,
    ...overrides,
  };
}

test("bulk driver update includes dated and undated rows without changing the site", async () => {
  actor = editor;
  const dated = await createDelivery({
    plannedDate: "2080-01-05",
    scheduleMonth: "2080-01",
  });
  const undated = await createDelivery({
    plannedDate: null,
    scheduleMonth: "2080-01",
  });

  const response = await update({
    deliveries: [snapshot(dated), snapshot(undated)],
    driverUserId: secondDriver.id,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { updated: 2 });

  const rows = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.siteId, siteId));
  assert.equal(rows.find((row) => row.id === dated.id)?.driverUserId, secondDriver.id);
  assert.equal(rows.find((row) => row.id === undated.id)?.driverUserId, secondDriver.id);
  const [site] = await db
    .select({ driverUserId: sitesTable.driverUserId })
    .from(sitesTable)
    .where(eq(sitesTable.id, siteId));
  assert.equal(site.driverUserId, firstDriver.id);
});

test("bulk date update preserves first planned date", async () => {
  actor = editor;
  const delivery = await createDelivery({
    plannedDate: "2080-02-05",
    scheduleMonth: "2080-02",
    rescheduledFromDate: "2080-02-01",
  });
  const response = await update({
    deliveries: [snapshot(delivery)],
    plannedDate: "2080-02-20",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { updated: 1 });
  const [persisted] = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, delivery.id));
  assert.equal(persisted.plannedDate, "2080-02-20");
  assert.equal(persisted.rescheduledFromDate, "2080-02-01");
  assert.ok(persisted.rescheduledAt);
});

test("unchanged date is a no-op and does not manufacture reschedule history", async () => {
  actor = editor;
  const delivery = await createDelivery({
    plannedDate: "2080-12-05",
    scheduleMonth: "2080-12",
  });
  const response = await update({
    deliveries: [snapshot(delivery)],
    plannedDate: "2080-12-05",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { updated: 0 });
  const [persisted] = await db
    .select({
      rescheduledFromDate: deliveriesTable.rescheduledFromDate,
      rescheduledBy: deliveriesTable.rescheduledBy,
      rescheduledAt: deliveriesTable.rescheduledAt,
    })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, delivery.id));
  assert.equal(persisted.rescheduledFromDate, null);
  assert.equal(persisted.rescheduledBy, null);
  assert.equal(persisted.rescheduledAt, null);
});

test("bulk update rejects empty snapshots and zero or multiple changes", async () => {
  actor = editor;
  assert.equal(
    (await update({ deliveries: [], driverUserId: null })).status,
    400,
  );
  const delivery = await createDelivery({
    plannedDate: "2080-03-05",
    scheduleMonth: "2080-03",
  });
  assert.equal((await update({ deliveries: [snapshot(delivery)] })).status, 400);
  assert.equal(
    (
      await update({
        deliveries: [snapshot(delivery), snapshot(delivery)],
        driverUserId: null,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await update({
        deliveries: [snapshot(delivery)],
        driverUserId: null,
        plannedDate: "2080-03-10",
      })
    ).status,
    400,
  );
});

test("bulk update requires delivery editing permission", async () => {
  actor = readonlyUser;
  const delivery = await createDelivery({
    plannedDate: "2080-04-05",
    scheduleMonth: "2080-04",
  });
  assert.equal(
    (
      await update({
        deliveries: [snapshot(delivery)],
        driverUserId: secondDriver.id,
      })
    ).status,
    403,
  );
});

test("bulk update validates the driver and planned date rules", async () => {
  actor = editor;
  const delivery = await createDelivery({
    plannedDate: "2080-11-05",
    scheduleMonth: "2080-11",
  });
  assert.equal(
    (
      await update({
        deliveries: [snapshot(delivery)],
        driverUserId: editor.id,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await update({
        deliveries: [snapshot(delivery)],
        plannedDate: "2080-11-31",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await update({
        deliveries: [snapshot(delivery)],
        plannedDate: "2080-12-01",
      })
    ).status,
    409,
  );
});

test("stale snapshot rolls the whole update back", async () => {
  actor = editor;
  const first = await createDelivery({
    plannedDate: "2080-05-05",
    scheduleMonth: "2080-05",
  });
  const stale = await createDelivery({
    plannedDate: "2080-06-05",
    scheduleMonth: "2080-06",
  });
  const response = await update({
    deliveries: [
      snapshot(first),
      snapshot(stale, { expectedPlannedDate: "2080-06-06" }),
    ],
    driverUserId: secondDriver.id,
  });
  assert.equal(response.status, 409);
  const [persisted] = await db
    .select({ driverUserId: deliveriesTable.driverUserId })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, first.id));
  assert.equal(persisted.driverUserId, firstDriver.id);
});

test("archived, completed, and closed deliveries are rejected", async () => {
  actor = editor;
  const cases = [
    await createDelivery({
      plannedDate: "2080-07-05",
      scheduleMonth: "2080-07",
      archivedAt: new Date(),
    }),
    await createDelivery({
      plannedDate: "2080-08-05",
      scheduleMonth: "2080-08",
      actualDate: "2080-08-05",
    }),
    await createDelivery({
      plannedDate: "2080-09-05",
      scheduleMonth: "2080-09",
      actApprovedAt: new Date(),
    }),
  ];
  for (const delivery of cases) {
    const response = await update({
      deliveries: [snapshot(delivery)],
      driverUserId: secondDriver.id,
    });
    assert.equal(response.status, 409);
  }
});

test("duplicate target date returns 409 and rolls every row back", async () => {
  actor = editor;
  const first = await createDelivery({
    plannedDate: "2080-10-05",
    scheduleMonth: "2080-10",
  });
  const second = await createDelivery({
    plannedDate: "2080-10-06",
    scheduleMonth: "2080-10",
  });
  const response = await update({
    deliveries: [snapshot(first), snapshot(second)],
    plannedDate: "2080-10-20",
  });
  assert.equal(response.status, 409);
  const rows = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.siteId, siteId));
  assert.equal(rows.find((row) => row.id === first.id)?.plannedDate, "2080-10-05");
  assert.equal(rows.find((row) => row.id === second.id)?.plannedDate, "2080-10-06");
});