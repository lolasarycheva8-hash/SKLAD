import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";

import {
  db,
  deliveriesTable,
  deliveryPhotosTable,
  deliveryTypesTable,
  deliveryUploadCleanupStatusTable,
  clientsTable,
  movementsTable,
  orderItemsTable,
  ordersTable,
  pool,
  productsTable,
  shipmentItemsTable,
  shipmentsTable,
  sitesTable,
  appUsersTable,
  legacyDriverSimilarityReviewsTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import express from "express";

import deliveriesRouter, {
  isDeliveryScheduleUniqueViolation,
} from "../routes/deliveries.ts";
import deliveryTypesRouter from "../routes/delivery-types.ts";
import lookupsRouter from "../routes/lookups.ts";
import myRouter from "../routes/my.ts";
import ordersRouter from "../routes/orders.ts";
import shipmentsRouter from "../routes/shipments.ts";
import sitesRouter from "../routes/sites.ts";
import storageRouter from "../routes/storage.ts";
import legacyDriverAssignmentsRouter from "../routes/legacy-driver-assignments.ts";
import {
  createProductionDeliveryUploadCleanupDependencies,
  runLiveDeliveryUploadCleanup,
} from "./delivery-upload-cleanup.ts";
import {
  acquireDeliveryUploadCleanupStatusLock,
  releaseDeliveryUploadCleanupSessionLock,
  tryAcquireDeliveryUploadCleanupSessionLock,
} from "./delivery-upload-lock.ts";
import {
  AutomaticCleanupStatusRecordingError,
  createAutomaticCleanupRunRecorder,
  createAutomaticCleanupStatusWriter,
} from "./delivery-upload-cleanup-status.ts";
import { ObjectStorageService } from "./objectStorage.ts";
import type { AuthenticatedAppUser } from "./user-roles.ts";

const app = express();
app.use(express.json());

let actor: AuthenticatedAppUser;
let integrationClientId = "";
const integrationClientName = `Интеграционный клиент ${randomUUID()}`;
app.use((req, _res, next) => {
  req.appUser = actor;
  req.log = {
    error() {},
    info() {},
  } as unknown as typeof req.log;
  next();
});
app.use(deliveriesRouter);
app.use(deliveryTypesRouter);
app.use(lookupsRouter);
app.use(myRouter);
app.use(ordersRouter);
app.use(shipmentsRouter);
app.use(sitesRouter);
app.use(storageRouter);
app.use(legacyDriverAssignmentsRouter);

let baseUrl = "";
let siteId = "";
let deliveryId = "";
let photoId = "";
const duplicateObjectPath = `/objects/uploads/${randomUUID()}`;
const deletedObjectPaths: string[] = [];
const storageDeleteResults: Array<{
  objectPath: string;
  deleted: boolean;
}> = [];
const storageDeleteAttempts: string[] = [];
let storageDeleteError: Error | null = null;
let successfulDeletesBeforeError: number | null = null;
let pausedDeletePath: string | null = null;
let pausedDeleteError: Error | null = null;
let notifyDeleteStarted: (() => void) | null = null;
let continueDelete: Promise<void> | null = null;
const cleanupLogger = {
  error() {},
  info() {},
  debug() {},
};

ObjectStorageService.prototype.deleteObjectEntity = async function (
  objectPath,
) {
  storageDeleteAttempts.push(objectPath);
  if (storageDeleteError) {
    throw storageDeleteError;
  }
  if (successfulDeletesBeforeError === 0) {
    throw new Error("storage unavailable after partial cleanup");
  }
  if (objectPath === pausedDeletePath && continueDelete) {
    notifyDeleteStarted?.();
    await continueDelete;
    if (pausedDeleteError) {
      const error = pausedDeleteError;
      pausedDeleteError = null;
      throw error;
    }
  }
  if (deletedObjectPaths.includes(objectPath)) {
    storageDeleteResults.push({ objectPath, deleted: false });
    return false;
  }
  deletedObjectPaths.push(objectPath);
  storageDeleteResults.push({ objectPath, deleted: true });
  if (successfulDeletesBeforeError !== null) {
    successfulDeletesBeforeError -= 1;
  }
  return true;
};

function cleanupDependencies(objectPath: string) {
  return createProductionDeliveryUploadCleanupDependencies(
    db,
    deliveriesTable,
    deliveryPhotosTable,
    {
      listPrivateUploadObjects: async () => [
        {
          objectPath,
          createdAt: new Date("2020-01-01T00:00:00.000Z"),
        },
      ],
      deleteObjectEntity: (path) =>
        new ObjectStorageService().deleteObjectEntity(path),
    },
    cleanupLogger,
  );
}

function testUser(
  role: AuthenticatedAppUser["role"],
  options: {
    editableSections?: AuthenticatedAppUser["editableSections"];
    isDriver?: boolean;
  } = {},
): AuthenticatedAppUser {
  const now = new Date();
  return {
    id: randomUUID(),
    clerkUserId: `test-${randomUUID()}`,
    email: `test-${randomUUID()}@example.test`,
    name: "Тестовый пользователь",
    phone: null,
    role,
    editableSections: options.editableSections ?? [],
    isDriver: options.isDriver ?? false,
    assignedSiteIds: null,
    createdAt: now,
    updatedAt: now,
  };
}

const editor = testUser("logistician", {
  editableSections: ["deliveries", "shipments"],
});
const deliveriesOnlyLogistician = testUser("logistician", {
  editableSections: ["deliveries"],
});
const readonlyLogistician = testUser("logistician");
const admin = testUser("admin");
const manager = testUser("manager", { editableSections: ["deliveries"] });
const assignedDriver = testUser("driver");
const otherDriver = testUser("driver");

const server = app.listen(0);

before(async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Integration tests must not run against production");
  }
  await db
    .insert(appUsersTable)
    .values([assignedDriver, otherDriver, editor, manager, admin]);
  const [integrationClient] = await db
    .insert(clientsTable)
    .values({ name: integrationClientName })
    .returning({ id: clientsTable.id });
  integrationClientId = integrationClient.id;

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  const [site] = await db
    .insert(sitesTable)
    .values({
      name: `Тест актов ${randomUUID()}`,
      address: "Тестовый адрес",
      branch: "Тестовый куст",
      client: integrationClientName,
      clientId: integrationClientId,
      manager: "Тестовый менеджер",
      managerContact: "+7 999 123-45-67",
      director: "Тестовый руководитель",
      project: "Тестовый проект",
      driverUserId: assignedDriver.id,
    })
    .returning({ id: sitesTable.id });
  siteId = site.id;

  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2026-09-15",
      actualDate: "2026-09-15",
    })
    .returning({ id: deliveriesTable.id });
  deliveryId = delivery.id;

  const [photo] = await db
    .insert(deliveryPhotosTable)
    .values({
      deliveryId,
      objectPath: duplicateObjectPath,
      fileName: "акт.pdf",
      mimeType: "application/pdf",
      uploadedBy: "Интеграционный тест",
    })
    .returning({ id: deliveryPhotosTable.id });
  photoId = photo.id;
});

after(async () => {
  if (siteId) {
    await db.delete(sitesTable).where(eq(sitesTable.id, siteId));
  }
  await db.delete(clientsTable).where(eq(clientsTable.id, integrationClientId));
  for (const user of [assignedDriver, otherDriver, editor, manager, admin]) {
    await db.delete(appUsersTable).where(eq(appUsersTable.id, user.id));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await pool.end();
});

test("маршрут подтверждает дату в плановом месяце и отклоняет другой месяц", async () => {
  actor = editor;

  const confirmed = await fetch(`${baseUrl}/deliveries/${deliveryId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actualDate: "2026-09-20" }),
  });
  assert.equal(confirmed.status, 200);
  const confirmedBody = (await confirmed.json()) as { actualDate: string };
  assert.equal(confirmedBody.actualDate.slice(0, 10), "2026-09-20");

  const outsideMonth = await fetch(`${baseUrl}/deliveries/${deliveryId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actualDate: "2026-10-01" }),
  });
  assert.equal(outsideMonth.status, 400);
  const outsideMonthBody = (await outsideMonth.json()) as { error: string };
  assert.match(outsideMonthBody.error, /в том же месяце/);
});

test("уточнённая дата доступна только редактору графика и не меняет исходные показатели", async () => {
  const approvedAt = new Date("2048-02-13T10:00:00.000Z");
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2048-02-10",
      scheduleMonth: "2048-02",
      actualDate: "2048-02-12",
      actApprovedAt: approvedAt,
      actApprovedBy: admin.id,
      correctedPlannedDate: null,
    })
    .returning({ id: deliveriesTable.id });

  try {
    actor = admin;
    const created = await fetch(`${baseUrl}/deliveries/${delivery.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ correctedPlannedDate: "2048-03-05" }),
    });
    assert.equal(created.status, 200);
    const createdBody = (await created.json()) as {
      correctedPlannedDate?: string | null;
      plannedDate: string;
      scheduleMonth: string;
      actualDate: string;
      actApprovedAt: string;
      actApprovedBy: string;
      status: string;
      lagDays: number | null;
      workflowStatus: string;
    };
    assert.equal(createdBody.correctedPlannedDate?.slice(0, 10), "2048-03-05");
    assert.equal(createdBody.plannedDate.slice(0, 10), "2048-02-10");
    assert.equal(createdBody.scheduleMonth, "2048-02");
    assert.equal(createdBody.actualDate.slice(0, 10), "2048-02-12");
    assert.equal(createdBody.actApprovedAt, approvedAt.toISOString());
    assert.equal(createdBody.actApprovedBy, admin.id);
    assert.equal(createdBody.status, "late");
    assert.equal(createdBody.lagDays, 2);
    assert.equal(createdBody.workflowStatus, "closed");

    for (const invalidDate of ["2048-02-30", "03/05/2048", "2048-3-05"]) {
      const invalid = await fetch(`${baseUrl}/deliveries/${delivery.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ correctedPlannedDate: invalidDate }),
      });
      assert.equal(invalid.status, 400, invalidDate);
    }

    for (const deniedActor of [manager, assignedDriver, readonlyLogistician]) {
      actor = deniedActor;
      const denied = await fetch(`${baseUrl}/deliveries/${delivery.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ correctedPlannedDate: "2048-03-06" }),
      });
      assert.equal(denied.status, 403, deniedActor.role);
    }

    actor = editor;
    const replaced = await fetch(`${baseUrl}/deliveries/${delivery.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ correctedPlannedDate: "2048-04-07" }),
    });
    assert.equal(replaced.status, 200);

    const listed = await fetch(`${baseUrl}/deliveries?month=2048-02`);
    assert.equal(listed.status, 200);
    const listedDelivery = (
      (await listed.json()) as Array<{
        id: string;
        correctedPlannedDate?: string | null;
      }>
    ).find((item) => item.id === delivery.id);
    assert.ok(listedDelivery);
    assert.equal(
      listedDelivery.correctedPlannedDate?.slice(0, 10),
      "2048-04-07",
    );

    actor = assignedDriver;
    const driverList = await fetch(`${baseUrl}/my/deliveries`);
    assert.equal(driverList.status, 200);
    const driverDelivery = (
      (await driverList.json()) as Array<{
        id: string;
        correctedPlannedDate?: string | null;
      }>
    ).find((item) => item.id === delivery.id);
    assert.ok(driverDelivery);
    assert.equal(
      driverDelivery.correctedPlannedDate?.slice(0, 10),
      "2048-04-07",
    );

    actor = editor;
    const cleared = await fetch(`${baseUrl}/deliveries/${delivery.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ correctedPlannedDate: null }),
    });
    assert.equal(cleared.status, 200);
    assert.equal(
      ((await cleared.json()) as { correctedPlannedDate?: string | null })
        .correctedPlannedDate,
      null,
    );

    const [persisted] = await db
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, delivery.id));
    assert.equal(persisted.correctedPlannedDate, null);
    assert.equal(persisted.plannedDate, "2048-02-10");
    assert.equal(persisted.scheduleMonth, "2048-02");
    assert.equal(persisted.actualDate, "2048-02-12");
    assert.equal(
      persisted.actApprovedAt?.toISOString(),
      approvedAt.toISOString(),
    );
    assert.equal(persisted.actApprovedBy, admin.id);
  } finally {
    await db.delete(deliveriesTable).where(eq(deliveriesTable.id, delivery.id));
  }
});

test("уточнённая дата требует исходный план и очищается вместе с ним", async () => {
  const [undated] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      scheduleMonth: "2049-01",
    })
    .returning({ id: deliveriesTable.id });
  const [dated] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2049-02-10",
      correctedPlannedDate: "2049-03-10",
      scheduleMonth: "2049-02",
    })
    .returning({ id: deliveriesTable.id });

  try {
    actor = editor;
    const withoutPlan = await fetch(`${baseUrl}/deliveries/${undated.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ correctedPlannedDate: "2049-01-15" }),
    });
    assert.equal(withoutPlan.status, 409);

    const planOnlyClear = await fetch(`${baseUrl}/deliveries/${dated.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plannedDate: null }),
    });
    assert.equal(planOnlyClear.status, 409);

    const jointClear = await fetch(`${baseUrl}/deliveries/${dated.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        plannedDate: null,
        correctedPlannedDate: null,
      }),
    });
    assert.equal(jointClear.status, 200);

    await db
      .update(deliveriesTable)
      .set({ correctedPlannedDate: "2049-01-20" })
      .where(eq(deliveriesTable.id, undated.id));
    const legacyClear = await fetch(`${baseUrl}/deliveries/${undated.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ correctedPlannedDate: null }),
    });
    assert.equal(legacyClear.status, 200);
  } finally {
    await db
      .delete(deliveriesTable)
      .where(inArray(deliveriesTable.id, [undated.id, dated.id]));
  }
});

test("уточнённая дата и очистка исходного плана не нарушают инвариант при гонке", async () => {
  const lockKey = 196011;
  const triggerName = "test_pause_corrected_planned_date_update";
  const functionName = "test_pause_corrected_planned_date_update";
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2049-04-10",
      scheduleMonth: "2049-04",
    })
    .returning({ id: deliveriesTable.id });
  const blocker = await pool.connect();

  try {
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON deliveries`);
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await pool.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        IF NEW.id = '${delivery.id}'::uuid
           AND NEW.corrected_planned_date IS NOT NULL THEN
          PERFORM pg_advisory_xact_lock(${lockKey});
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE UPDATE ON deliveries
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock($1)", [lockKey]);

    actor = editor;
    const correctionResponse = fetch(`${baseUrl}/deliveries/${delivery.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ correctedPlannedDate: "2049-05-15" }),
    });
    await waitForAdvisoryLockWaiter(lockKey);

    const clearPlanResponse = fetch(`${baseUrl}/deliveries/${delivery.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plannedDate: null }),
    });
    await waitForRowUpdateLockWaiter();
    await blocker.query("COMMIT");

    const [correction, clearPlan] = await Promise.all([
      correctionResponse,
      clearPlanResponse,
    ]);
    assert.equal(correction.status, 200);
    assert.equal(clearPlan.status, 409);

    const [persisted] = await db
      .select({
        plannedDate: deliveriesTable.plannedDate,
        correctedPlannedDate: deliveriesTable.correctedPlannedDate,
      })
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, delivery.id));
    assert.deepEqual(persisted, {
      plannedDate: "2049-04-10",
      correctedPlannedDate: "2049-05-15",
    });
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON deliveries`);
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await db.delete(deliveriesTable).where(eq(deliveriesTable.id, delivery.id));
  }
});

test("расширенное создание сохраняет тип и даты, не изменяя объект и другие доставки", async () => {
  const deliveryType = `Тип создания ${randomUUID()}`;
  await db.insert(deliveryTypesTable).values({ name: deliveryType });
  const [siteBefore] = await db
    .select({ deliveryType: sitesTable.deliveryType })
    .from(sitesTable)
    .where(eq(sitesTable.id, siteId));
  const [unrelated] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2051-01-10",
      scheduleMonth: "2051-01",
      correctedPlannedDate: "2051-02-20",
      deliveryType,
    })
    .returning();
  let createdId = "";

  try {
    actor = deliveriesOnlyLogistician;
    const typeLookup = await fetch(`${baseUrl}/deliveries/type-lookup`);
    assert.equal(typeLookup.status, 200);
    assert.ok(
      (
        (await typeLookup.json()) as Array<{
          name: string;
        }>
      ).some((entry) => entry.name === deliveryType),
    );
    const siteScopedTypes = await fetch(`${baseUrl}/delivery-types`);
    assert.equal(siteScopedTypes.status, 403);

    const created = await fetch(`${baseUrl}/deliveries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        siteId,
        driverUserId: assignedDriver.id,
        plannedDate: "2051-03-10",
        actualDate: "2051-03-12",
        correctedPlannedDate: "2051-04-15",
        deliveryType,
      }),
    });
    assert.equal(created.status, 201);
    const body = (await created.json()) as {
      id: string;
      plannedDate: string;
      actualDate: string | null;
      correctedPlannedDate?: string | null;
      deliveryType?: string | null;
      status: string;
      lagDays: number | null;
    };
    createdId = body.id;
    assert.equal(body.plannedDate.slice(0, 10), "2051-03-10");
    assert.equal(body.actualDate?.slice(0, 10), "2051-03-12");
    assert.equal(body.correctedPlannedDate?.slice(0, 10), "2051-04-15");
    assert.equal(body.deliveryType, deliveryType);
    assert.equal(body.status, "late");
    assert.equal(body.lagDays, 2);

    const listed = await fetch(`${baseUrl}/deliveries?month=2051-03`);
    assert.equal(listed.status, 200);
    const roundTrip = (
      (await listed.json()) as Array<{
        id: string;
        actualDate: string | null;
        correctedPlannedDate?: string | null;
        deliveryType?: string | null;
      }>
    ).find((delivery) => delivery.id === createdId);
    assert.ok(roundTrip);
    assert.equal(roundTrip.actualDate?.slice(0, 10), "2051-03-12");
    assert.equal(roundTrip.correctedPlannedDate?.slice(0, 10), "2051-04-15");
    assert.equal(roundTrip.deliveryType, deliveryType);

    const invalidPayloads: Array<[Record<string, unknown>, number]> = [
      [{ plannedDate: "2051-05-10", actualDate: "2051-05-32" }, 400],
      [{ plannedDate: "2051-05-10", correctedPlannedDate: "2051-02-30" }, 400],
      [{ plannedDate: "2051-05-10", deliveryType: `Нет ${randomUUID()}` }, 400],
      [{ scheduleMonth: "2051-05", actualDate: "2051-05-10" }, 409],
      [
        {
          plannedDate: "2051-05-10",
          actualDate: "2051-06-01",
        },
        400,
      ],
      [
        {
          scheduleMonth: "2051-05",
          correctedPlannedDate: "2051-06-01",
        },
        409,
      ],
    ];
    for (const [payload, expectedStatus] of invalidPayloads) {
      const invalid = await fetch(`${baseUrl}/deliveries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteId,
          driverUserId: assignedDriver.id,
          ...payload,
        }),
      });
      assert.equal(invalid.status, expectedStatus, JSON.stringify(payload));
    }

    const [siteAfter] = await db
      .select({ deliveryType: sitesTable.deliveryType })
      .from(sitesTable)
      .where(eq(sitesTable.id, siteId));
    assert.deepEqual(siteAfter, siteBefore);
    const [unrelatedAfter] = await db
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, unrelated.id));
    assert.equal(unrelatedAfter.correctedPlannedDate, "2051-02-20");
    assert.equal(unrelatedAfter.deliveryType, deliveryType);
  } finally {
    if (createdId) {
      await db.delete(deliveriesTable).where(eq(deliveriesTable.id, createdId));
    }
    await db
      .delete(deliveriesTable)
      .where(eq(deliveriesTable.id, unrelated.id));
    await db
      .delete(deliveryTypesTable)
      .where(eq(deliveryTypesTable.name, deliveryType));
  }
});

test("расширенное bulk и replace создание сохраняет поля и не стирает их при пропуске", async () => {
  const deliveryType = `Тип bulk ${randomUUID()}`;
  await db.insert(deliveryTypesTable).values({ name: deliveryType });
  const [preserved] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2052-04-10",
      scheduleMonth: "2052-04",
      correctedPlannedDate: "2052-05-20",
      deliveryType,
    })
    .returning();
  const [preservedUndated] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      scheduleMonth: "2052-09",
    })
    .returning();

  try {
    actor = admin;
    const duplicate = await fetch(`${baseUrl}/deliveries/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            siteId,
            driverUserId: assignedDriver.id,
            plannedDate: "2052-04-10",
          },
        ],
      }),
    });
    assert.equal(duplicate.status, 201);
    assert.deepEqual(await duplicate.json(), []);
    const [afterDuplicate] = await db
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, preserved.id));
    assert.equal(afterDuplicate.correctedPlannedDate, "2052-05-20");
    assert.equal(afterDuplicate.deliveryType, deliveryType);

    const invalidBulk = await fetch(`${baseUrl}/deliveries/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            siteId,
            driverUserId: assignedDriver.id,
            plannedDate: "2052-08-10",
            deliveryType,
          },
          {
            siteId,
            driverUserId: assignedDriver.id,
            plannedDate: "2052-08-20",
            deliveryType: `Нет ${randomUUID()}`,
          },
        ],
      }),
    });
    assert.equal(invalidBulk.status, 400);
    const invalidBulkWrites = await db
      .select({ id: deliveriesTable.id })
      .from(deliveriesTable)
      .where(
        and(
          eq(deliveriesTable.siteId, siteId),
          eq(deliveriesTable.scheduleMonth, "2052-08"),
        ),
      );
    assert.deepEqual(invalidBulkWrites, []);

    const bulk = await fetch(`${baseUrl}/deliveries/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            siteId,
            driverUserId: assignedDriver.id,
            plannedDate: "2052-06-10",
            actualDate: "2052-06-11",
            correctedPlannedDate: "2052-07-12",
            deliveryType,
          },
        ],
      }),
    });
    assert.equal(bulk.status, 201);
    const [bulkBody] = (await bulk.json()) as Array<{
      actualDate: string | null;
      correctedPlannedDate?: string | null;
      deliveryType?: string | null;
    }>;
    assert.equal(bulkBody.actualDate?.slice(0, 10), "2052-06-11");
    assert.equal(bulkBody.correctedPlannedDate?.slice(0, 10), "2052-07-12");
    assert.equal(bulkBody.deliveryType, deliveryType);

    const invalidReplace = await fetch(`${baseUrl}/deliveries/bulk/replace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        month: "2052-04",
        items: [
          {
            siteId,
            driverUserId: assignedDriver.id,
            plannedDate: "2052-04-10",
            actualDate: "2052-05-01",
          },
        ],
      }),
    });
    assert.equal(invalidReplace.status, 400);
    const [afterInvalidReplace] = await db
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, preserved.id));
    assert.equal(afterInvalidReplace.correctedPlannedDate, "2052-05-20");
    assert.equal(afterInvalidReplace.deliveryType, deliveryType);

    const replaced = await fetch(`${baseUrl}/deliveries/bulk/replace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        month: "2052-04",
        items: [
          {
            siteId,
            driverUserId: assignedDriver.id,
            plannedDate: "2052-04-10",
          },
          {
            siteId,
            driverUserId: assignedDriver.id,
            plannedDate: "2052-04-20",
            actualDate: "2052-04-21",
            correctedPlannedDate: "2052-08-01",
            deliveryType,
          },
        ],
      }),
    });
    assert.equal(replaced.status, 201);
    const replaceBody = (await replaced.json()) as Array<{
      plannedDate: string;
      actualDate: string | null;
      correctedPlannedDate?: string | null;
      deliveryType?: string | null;
    }>;
    const retained = replaceBody.find(
      (delivery) => delivery.plannedDate.slice(0, 10) === "2052-04-10",
    );
    assert.ok(retained);
    assert.equal(retained.correctedPlannedDate?.slice(0, 10), "2052-05-20");
    assert.equal(retained.deliveryType, deliveryType);
    const added = replaceBody.find(
      (delivery) => delivery.plannedDate.slice(0, 10) === "2052-04-20",
    );
    assert.ok(added);
    assert.equal(added.actualDate?.slice(0, 10), "2052-04-21");
    assert.equal(added.correctedPlannedDate?.slice(0, 10), "2052-08-01");
    assert.equal(added.deliveryType, deliveryType);

    const explicitValue = await fetch(`${baseUrl}/deliveries/bulk/replace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        month: "2052-09",
        items: [
          {
            siteId,
            driverUserId: assignedDriver.id,
            plannedDate: null,
            deliveryType,
          },
        ],
      }),
    });
    assert.equal(explicitValue.status, 201);
    let [undatedAfterMerge] = await db
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, preservedUndated.id));
    assert.equal(undatedAfterMerge.deliveryType, deliveryType);

    const explicitNull = await fetch(`${baseUrl}/deliveries/bulk/replace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        month: "2052-09",
        items: [
          {
            siteId,
            driverUserId: assignedDriver.id,
            plannedDate: null,
            deliveryType: null,
          },
        ],
      }),
    });
    assert.equal(explicitNull.status, 201);
    [undatedAfterMerge] = await db
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, preservedUndated.id));
    assert.equal(undatedAfterMerge.deliveryType, null);

    await db
      .update(deliveriesTable)
      .set({ deliveryType })
      .where(eq(deliveriesTable.id, preservedUndated.id));
    const omitted = await fetch(`${baseUrl}/deliveries/bulk/replace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        month: "2052-09",
        items: [
          {
            siteId,
            driverUserId: assignedDriver.id,
            plannedDate: null,
          },
        ],
      }),
    });
    assert.equal(omitted.status, 201);
    [undatedAfterMerge] = await db
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, preservedUndated.id));
    assert.equal(undatedAfterMerge.deliveryType, deliveryType);
  } finally {
    await db
      .delete(deliveriesTable)
      .where(
        and(
          eq(deliveriesTable.siteId, siteId),
          inArray(deliveriesTable.scheduleMonth, [
            "2052-04",
            "2052-06",
            "2052-09",
          ]),
        ),
      );
    await db
      .delete(deliveryTypesTable)
      .where(eq(deliveryTypesTable.name, deliveryType));
  }
});

test("конфликт графика распознаётся на верхнем уровне и во вложенном cause", () => {
  const postgresConflict = {
    code: "23505",
    constraint: "deliveries_owned_dated_uq",
  };

  assert.equal(isDeliveryScheduleUniqueViolation(postgresConflict), true);
  assert.equal(
    isDeliveryScheduleUniqueViolation({
      cause: {
        cause: postgresConflict,
      },
    }),
    true,
  );
  assert.equal(
    isDeliveryScheduleUniqueViolation({
      code: "23505",
      constraint: "another_unique_constraint",
    }),
    false,
  );
});

test("создание возвращает 409 для реальной обёрнутой ошибки уникальности графика", async () => {
  const plannedDate = "2044-04-10";
  const [existing] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate,
      scheduleMonth: "2044-04",
    })
    .returning({ id: deliveriesTable.id });

  try {
    actor = editor;
    const response = await fetch(`${baseUrl}/deliveries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        siteId,
        driverUserId: assignedDriver.id,
        plannedDate,
      }),
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "Такая строка графика уже существует",
    });
    const matching = await db
      .select({ id: deliveriesTable.id })
      .from(deliveriesTable)
      .where(
        and(
          eq(deliveriesTable.siteId, siteId),
          eq(deliveriesTable.scheduleMonth, "2044-04"),
          eq(deliveriesTable.plannedDate, plannedDate),
        ),
      );
    assert.deepEqual(matching, [{ id: existing.id }]);
  } finally {
    await db.delete(deliveriesTable).where(eq(deliveriesTable.id, existing.id));
  }
});

test("редактирование возвращает 409 для реальной обёрнутой ошибки уникальности графика", async () => {
  const originalDate = "2044-05-10";
  const occupiedDate = "2044-05-11";
  const deliveries = await db
    .insert(deliveriesTable)
    .values([
      {
        siteId,
        driverUserId: assignedDriver.id,
        plannedDate: originalDate,
        scheduleMonth: "2044-05",
      },
      {
        siteId,
        driverUserId: assignedDriver.id,
        plannedDate: occupiedDate,
        scheduleMonth: "2044-05",
      },
    ])
    .returning({
      id: deliveriesTable.id,
      plannedDate: deliveriesTable.plannedDate,
    });
  const edited = deliveries.find(
    (delivery) => delivery.plannedDate === originalDate,
  );
  assert.ok(edited);

  try {
    actor = editor;
    const response = await fetch(`${baseUrl}/deliveries/${edited.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plannedDate: occupiedDate }),
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "Такая строка графика уже существует",
    });
    const [unchanged] = await db
      .select({ plannedDate: deliveriesTable.plannedDate })
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, edited.id));
    assert.equal(unchanged.plannedDate, originalDate);
  } finally {
    await db.delete(deliveriesTable).where(
      inArray(
        deliveriesTable.id,
        deliveries.map(({ id }) => id),
      ),
    );
  }
});

test("выгрузка актов за период строго проверяет даты и права", async () => {
  actor = editor;
  for (const [query, expectedError] of [
    ["from=2026-02-30&to=2026-03-01", /корректные даты/],
    ["from=2026-09-02&to=2026-09-01", /не может быть позже/],
    ["from=2025-01-01&to=2026-01-02", /366 дней/],
  ] as const) {
    const response = await fetch(
      `${baseUrl}/deliveries/acts/download?${query}`,
    );
    assert.equal(response.status, 400);
    assert.match(
      String(((await response.json()) as { error?: string }).error),
      expectedError,
    );
  }

  actor = assignedDriver;
  const forbidden = await fetch(
    `${baseUrl}/deliveries/acts/download?from=2026-09-01&to=2026-09-30`,
  );
  assert.equal(forbidden.status, 403);

  actor = manager;
  const head = await fetch(
    `${baseUrl}/deliveries/acts/download?from=2026-09-20&to=2026-09-20`,
    { method: "HEAD" },
  );
  assert.equal(head.status, 502);
  const headError = decodeURIComponent(
    head.headers.get("x-download-error") ?? "",
  );
  assert.equal(headError, "Не удалось подготовить архив актов");
  assert.equal(headError.includes("objects"), false);

  const empty = await fetch(
    `${baseUrl}/deliveries/acts/download?from=2030-01-01&to=2030-01-31`,
  );
  assert.equal(empty.status, 404);
  assert.equal(
    empty.headers.get("content-type")?.includes("application/json"),
    true,
  );
});

test("одиночная выгрузка сохраняет 404/403 семантику ACL", async () => {
  actor = otherDriver;
  const forbidden = await fetch(
    `${baseUrl}/deliveries/${deliveryId}/acts/download`,
  );
  assert.equal(forbidden.status, 403);

  const missing = await fetch(
    `${baseUrl}/deliveries/${randomUUID()}/acts/download`,
  );
  assert.equal(missing.status, 404);
});

test("одиночная выгрузка не возвращает доставку или фото, помеченные удалёнными", async () => {
  actor = admin;
  await db
    .update(deliveriesTable)
    .set({ deletionPendingAt: new Date() })
    .where(eq(deliveriesTable.id, deliveryId));
  try {
    const deletedDelivery = await fetch(
      `${baseUrl}/deliveries/${deliveryId}/acts/download`,
    );
    assert.equal(deletedDelivery.status, 404);
  } finally {
    await db
      .update(deliveriesTable)
      .set({ deletionPendingAt: null })
      .where(eq(deliveriesTable.id, deliveryId));
  }

  await db
    .update(deliveryPhotosTable)
    .set({ deletionPendingAt: new Date() })
    .where(eq(deliveryPhotosTable.id, photoId));
  try {
    const deletedPhoto = await fetch(
      `${baseUrl}/deliveries/${deliveryId}/acts/download`,
    );
    assert.equal(deletedPhoto.status, 404);
  } finally {
    await db
      .update(deliveryPhotosTable)
      .set({ deletionPendingAt: null })
      .where(eq(deliveryPhotosTable.id, photoId));
  }
});

test("ошибка открытия первого файла возвращает JSON без attachment и приватного пути", async () => {
  actor = admin;
  const response = await fetch(
    `${baseUrl}/deliveries/${deliveryId}/acts/download`,
  );
  assert.equal(response.status, 502);
  assert.equal(
    response.headers.get("content-type")?.includes("application/json"),
    true,
  );
  assert.equal(response.headers.get("content-disposition"), null);
  const body = (await response.json()) as { error?: string };
  assert.equal(body.error, "Не удалось сформировать архив актов");
  assert.equal(JSON.stringify(body).includes("objects/uploads"), false);
  assert.equal(JSON.stringify(body).includes(duplicateObjectPath), false);
});

test("администратор безопасно сопоставляет legacy-имя с пользователем-водителем", async () => {
  const legacyName = `vLegacy-${randomUUID()}v`;
  const createdSiteIds: string[] = [];
  try {
    const createdSites = await db
      .insert(sitesTable)
      .values([
        {
          name: `Legacy объект ${randomUUID()}`,
          address: "Тестовый адрес",
          branch: "Тестовый куст",
          client: integrationClientName,
          clientId: integrationClientId,
          manager: "Тестовый менеджер",
          director: "Тестовый руководитель",
          project: "Тестовый проект",
          legacyDriver: ` \v\t${legacyName}\u00a0 `,
        },
        {
          name: `Подтверждённый legacy объект ${randomUUID()}`,
          address: "Тестовый адрес",
          branch: "Тестовый куст",
          client: integrationClientName,
          clientId: integrationClientId,
          manager: "Тестовый менеджер",
          director: "Тестовый руководитель",
          project: "Тестовый проект",
          legacyDriver: legacyName,
          driverUserId: otherDriver.id,
        },
      ])
      .returning({ id: sitesTable.id });
    createdSiteIds.push(...createdSites.map((site) => site.id));

    await db.insert(deliveriesTable).values([
      {
        siteId: createdSites[0].id,
        legacyDriver: `\u00a0${legacyName}\v`,
      },
      {
        siteId: createdSites[1].id,
        legacyDriver: legacyName,
        driverUserId: otherDriver.id,
      },
    ]);

    actor = editor;
    const forbidden = await fetch(`${baseUrl}/admin/legacy-driver-assignments`);
    assert.equal(forbidden.status, 403);

    actor = admin;
    const listed = await fetch(`${baseUrl}/admin/legacy-driver-assignments`);
    assert.equal(listed.status, 200);
    const listedBody = (await listed.json()) as Array<{
      legacyName: string;
      siteCount: number;
      deliveryCount: number;
      totalCount: number;
      similarityGroup: string | null;
    }>;
    assert.deepEqual(
      listedBody.find((item) => item.legacyName === legacyName),
      {
        legacyName,
        siteCount: 1,
        deliveryCount: 1,
        totalCount: 2,
        similarityGroup: null,
        similarityReviewed: false,
        similarityReviewedAt: null,
        similarityReviewedByName: null,
        similarityReviewedByDeleted: false,
      },
    );

    const conflictingDuplicate = await fetch(
      `${baseUrl}/admin/legacy-driver-assignments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mappings: [
            {
              legacyName: `\t${legacyName}`,
              driverUserId: assignedDriver.id,
            },
            {
              legacyName: `${legacyName}\u00a0`,
              driverUserId: otherDriver.id,
            },
          ],
        }),
      },
    );
    assert.equal(conflictingDuplicate.status, 400);
    assert.match(
      String(((await conflictingDuplicate.json()) as { error?: string }).error),
      /уникальным/,
    );
    const unchangedSites = await db
      .select({ driverUserId: sitesTable.driverUserId })
      .from(sitesTable)
      .where(eq(sitesTable.id, createdSites[0].id));
    const unchangedDeliveries = await db
      .select({ driverUserId: deliveriesTable.driverUserId })
      .from(deliveriesTable)
      .where(
        and(
          eq(deliveriesTable.siteId, createdSites[0].id),
          isNull(deliveriesTable.driverUserId),
        ),
      );
    assert.deepEqual(unchangedSites, [{ driverUserId: null }]);
    assert.equal(unchangedDeliveries.length, 1);

    const invalidDriver = await fetch(
      `${baseUrl}/admin/legacy-driver-assignments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mappings: [{ legacyName, driverUserId: manager.id }],
        }),
      },
    );
    assert.equal(invalidDriver.status, 400);

    const resolved = await fetch(`${baseUrl}/admin/legacy-driver-assignments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mappings: [{ legacyName, driverUserId: assignedDriver.id }],
      }),
    });
    assert.equal(resolved.status, 200);
    assert.deepEqual(await resolved.json(), {
      results: [
        {
          legacyName,
          driverUserId: assignedDriver.id,
          siteCount: 1,
          deliveryCount: 1,
          totalCount: 2,
        },
      ],
      sitesUpdated: 1,
      deliveriesUpdated: 1,
      totalUpdated: 2,
    });

    const siteRows = await db
      .select({
        id: sitesTable.id,
        legacyDriver: sitesTable.legacyDriver,
        driverUserId: sitesTable.driverUserId,
      })
      .from(sitesTable)
      .where(inArray(sitesTable.id, createdSiteIds));
    assert.deepEqual(
      siteRows
        .map((row) => ({
          legacyDriver: row.legacyDriver.trim(),
          driverUserId: row.driverUserId,
        }))
        .sort((left, right) =>
          (left.driverUserId ?? "").localeCompare(right.driverUserId ?? ""),
        ),
      [
        { legacyDriver: legacyName, driverUserId: assignedDriver.id },
        { legacyDriver: legacyName, driverUserId: otherDriver.id },
      ].sort((left, right) =>
        left.driverUserId.localeCompare(right.driverUserId),
      ),
    );

    const repeated = await fetch(`${baseUrl}/admin/legacy-driver-assignments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mappings: [{ legacyName, driverUserId: assignedDriver.id }],
      }),
    });
    assert.equal(repeated.status, 200);
    assert.deepEqual(await repeated.json(), {
      results: [
        {
          legacyName,
          driverUserId: assignedDriver.id,
          siteCount: 0,
          deliveryCount: 0,
          totalCount: 0,
        },
      ],
      sitesUpdated: 0,
      deliveriesUpdated: 0,
      totalUpdated: 0,
    });

    const afterResolution = await fetch(
      `${baseUrl}/admin/legacy-driver-assignments`,
    );
    assert.equal(afterResolution.status, 200);
    const afterResolutionBody = (await afterResolution.json()) as Array<{
      legacyName: string;
    }>;
    assert.equal(
      afterResolutionBody.some((item) => item.legacyName === legacyName),
      false,
    );
  } finally {
    if (createdSiteIds.length > 0) {
      await db.delete(sitesTable).where(inArray(sitesTable.id, createdSiteIds));
    }
  }
});

test("администратор сохраняет и отменяет проверку вероятной duplicate-группы", async () => {
  const suffix = randomUUID();
  const legacyNames = [`Проверка-${suffix}`, `Проверка ${suffix}`];
  const createdSiteIds: string[] = [];
  const reviewer = {
    ...testUser("admin"),
    name: "Проверяющий администратор",
  };

  try {
    await db.insert(appUsersTable).values(reviewer);
    const createdSites = await db
      .insert(sitesTable)
      .values(
        legacyNames.map((legacyDriver) => ({
          name: `Проверка дублей ${randomUUID()}`,
          address: "Тестовый адрес",
          branch: "Тестовый куст",
          client: integrationClientName,
          clientId: integrationClientId,
          manager: "Тестовый менеджер",
          director: "Тестовый руководитель",
          project: "Тестовый проект",
          legacyDriver,
        })),
      )
      .returning({ id: sitesTable.id });
    createdSiteIds.push(...createdSites.map((site) => site.id));

    actor = admin;
    const initialResponse = await fetch(
      `${baseUrl}/admin/legacy-driver-assignments`,
    );
    assert.equal(initialResponse.status, 200);
    const initialItems = (await initialResponse.json()) as Array<{
      legacyName: string;
      similarityGroup: string | null;
      similarityReviewed: boolean;
      similarityReviewedAt: string | null;
      similarityReviewedByName: string | null;
      similarityReviewedByDeleted: boolean;
    }>;
    const fixtureItems = initialItems.filter((item) =>
      legacyNames.includes(item.legacyName),
    );
    assert.equal(fixtureItems.length, 2);
    for (const item of fixtureItems) {
      assert.equal(item.similarityReviewed, false);
      assert.equal(item.similarityReviewedAt, null);
      assert.equal(item.similarityReviewedByName, null);
      assert.equal(item.similarityReviewedByDeleted, false);
    }
    assert.equal(
      fixtureItems[0].similarityGroup,
      fixtureItems[1].similarityGroup,
    );
    const similarityGroup = fixtureItems[0].similarityGroup;
    assert(similarityGroup);

    actor = editor;
    const forbidden = await fetch(
      `${baseUrl}/admin/legacy-driver-similarity-reviews`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ similarityGroup, reviewed: true }),
      },
    );
    assert.equal(forbidden.status, 403);

    actor = reviewer;
    const reviewed = await fetch(
      `${baseUrl}/admin/legacy-driver-similarity-reviews`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ similarityGroup, reviewed: true }),
      },
    );
    assert.equal(reviewed.status, 200);
    assert.deepEqual(await reviewed.json(), {
      similarityGroup,
      reviewed: true,
    });

    const listed = await fetch(`${baseUrl}/admin/legacy-driver-assignments`);
    assert.equal(listed.status, 200);
    const listedItems = (await listed.json()) as Array<{
      legacyName: string;
      similarityGroup: string | null;
      similarityReviewed: boolean;
      similarityReviewedAt: string | null;
      similarityReviewedByName: string | null;
      similarityReviewedByDeleted: boolean;
    }>;
    const reviewedItems = listedItems.filter((item) =>
      legacyNames.includes(item.legacyName),
    );
    assert.deepEqual(
      reviewedItems.map((item) => item.similarityGroup),
      [similarityGroup, similarityGroup],
    );
    assert.deepEqual(
      reviewedItems.map((item) => item.similarityReviewed),
      [true, true],
    );
    assert.deepEqual(
      reviewedItems.map((item) => item.similarityReviewedByName),
      [reviewer.name, reviewer.name],
    );
    assert.deepEqual(
      reviewedItems.map((item) => item.similarityReviewedByDeleted),
      [false, false],
    );
    assert(reviewedItems[0].similarityReviewedAt);
    assert.deepEqual(
      reviewedItems.map((item) => item.similarityReviewedAt),
      [
        reviewedItems[0].similarityReviewedAt,
        reviewedItems[0].similarityReviewedAt,
      ],
    );
    const reviewedAt = reviewedItems[0].similarityReviewedAt;

    const reviewAfterCreate = await db
      .select({
        reviewedByNameSnapshot:
          legacyDriverSimilarityReviewsTable.reviewedByNameSnapshot,
      })
      .from(legacyDriverSimilarityReviewsTable)
      .where(
        eq(legacyDriverSimilarityReviewsTable.similarityGroup, similarityGroup),
      );
    assert.equal(reviewAfterCreate[0]?.reviewedByNameSnapshot, reviewer.name);

    const updatedReviewerName =
      "Проверяющий администратор после переименования";
    await db
      .update(appUsersTable)
      .set({ name: updatedReviewerName })
      .where(eq(appUsersTable.id, reviewer.id));
    actor = { ...reviewer, name: updatedReviewerName };
    const updatedReview = await fetch(
      `${baseUrl}/admin/legacy-driver-similarity-reviews`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ similarityGroup, reviewed: true }),
      },
    );
    assert.equal(updatedReview.status, 200);
    const reviewAfterUpdate = await db
      .select({
        reviewedAt: legacyDriverSimilarityReviewsTable.reviewedAt,
        reviewedByNameSnapshot:
          legacyDriverSimilarityReviewsTable.reviewedByNameSnapshot,
      })
      .from(legacyDriverSimilarityReviewsTable)
      .where(
        eq(legacyDriverSimilarityReviewsTable.similarityGroup, similarityGroup),
      );
    assert.equal(
      reviewAfterUpdate[0]?.reviewedByNameSnapshot,
      updatedReviewerName,
    );
    const updatedReviewedAt = reviewAfterUpdate[0]?.reviewedAt.toISOString();
    assert(updatedReviewedAt);

    await db.delete(appUsersTable).where(eq(appUsersTable.id, reviewer.id));
    actor = admin;
    const afterReviewerDeletion = await fetch(
      `${baseUrl}/admin/legacy-driver-assignments`,
    );
    assert.equal(afterReviewerDeletion.status, 200);
    const afterReviewerDeletionItems =
      (await afterReviewerDeletion.json()) as Array<{
        legacyName: string;
        similarityGroup: string | null;
        similarityReviewed: boolean;
        similarityReviewedAt: string | null;
        similarityReviewedByName: string | null;
        similarityReviewedByDeleted: boolean;
      }>;
    const historicalItems = afterReviewerDeletionItems.filter((item) =>
      legacyNames.includes(item.legacyName),
    );
    assert.deepEqual(
      historicalItems.map((item) => item.similarityGroup),
      [similarityGroup, similarityGroup],
    );
    assert.deepEqual(
      historicalItems.map((item) => item.similarityReviewed),
      [true, true],
    );
    assert.deepEqual(
      historicalItems.map((item) => item.similarityReviewedByName),
      [updatedReviewerName, updatedReviewerName],
    );
    assert.deepEqual(
      historicalItems.map((item) => item.similarityReviewedByDeleted),
      [true, true],
    );
    assert.deepEqual(
      historicalItems.map((item) => item.similarityReviewedAt),
      [updatedReviewedAt, updatedReviewedAt],
    );

    const unreviewed = await fetch(
      `${baseUrl}/admin/legacy-driver-similarity-reviews`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ similarityGroup, reviewed: false }),
      },
    );
    assert.equal(unreviewed.status, 200);
    assert.deepEqual(await unreviewed.json(), {
      similarityGroup,
      reviewed: false,
    });

    const unreviewedList = await fetch(
      `${baseUrl}/admin/legacy-driver-assignments`,
    );
    assert.equal(unreviewedList.status, 200);
    const unreviewedItems = (await unreviewedList.json()) as Array<{
      legacyName: string;
      similarityReviewed: boolean;
      similarityReviewedAt: string | null;
      similarityReviewedByName: string | null;
      similarityReviewedByDeleted: boolean;
    }>;
    assert.deepEqual(
      unreviewedItems
        .filter((item) => legacyNames.includes(item.legacyName))
        .map((item) => ({
          reviewed: item.similarityReviewed,
          reviewedAt: item.similarityReviewedAt,
          reviewedByName: item.similarityReviewedByName,
          reviewedByDeleted: item.similarityReviewedByDeleted,
        })),
      legacyNames.map(() => ({
        reviewed: false,
        reviewedAt: null,
        reviewedByName: null,
        reviewedByDeleted: false,
      })),
    );
  } finally {
    if (createdSiteIds.length > 0) {
      await db.delete(sitesTable).where(inArray(sitesTable.id, createdSiteIds));
    }
    await db.delete(appUsersTable).where(eq(appUsersTable.id, reviewer.id));
  }
});

test("конкурирующие сопоставления не разделяют одно legacy-имя между водителями", async () => {
  const legacyName = `Конкурентный водитель ${randomUUID()}`;
  let createdSiteId = "";
  try {
    actor = admin;
    const [createdSite] = await db
      .insert(sitesTable)
      .values({
        name: `Конкурентный legacy объект ${randomUUID()}`,
        address: "Тестовый адрес",
        branch: "Тестовый куст",
        client: integrationClientName,
        clientId: integrationClientId,
        manager: "Тестовый менеджер",
        director: "Тестовый руководитель",
        project: "Тестовый проект",
        legacyDriver: legacyName,
      })
      .returning({ id: sitesTable.id });
    createdSiteId = createdSite.id;

    const [createdDelivery] = await db
      .insert(deliveriesTable)
      .values({
        siteId: createdSiteId,
        legacyDriver: legacyName,
      })
      .returning({ id: deliveriesTable.id });

    const [firstResponse, secondResponse] = await Promise.all([
      fetch(`${baseUrl}/admin/legacy-driver-assignments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mappings: [{ legacyName, driverUserId: assignedDriver.id }],
        }),
      }),
      fetch(`${baseUrl}/admin/legacy-driver-assignments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mappings: [{ legacyName, driverUserId: otherDriver.id }],
        }),
      }),
    ]);
    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);

    const responseBodies = (await Promise.all([
      firstResponse.json(),
      secondResponse.json(),
    ])) as Array<{ totalUpdated: number }>;
    assert.deepEqual(
      responseBodies.map((body) => body.totalUpdated).sort((a, b) => a - b),
      [0, 2],
    );

    const [siteRow] = await db
      .select({
        legacyDriver: sitesTable.legacyDriver,
        driverUserId: sitesTable.driverUserId,
      })
      .from(sitesTable)
      .where(eq(sitesTable.id, createdSiteId));
    const [deliveryRow] = await db
      .select({
        legacyDriver: deliveriesTable.legacyDriver,
        driverUserId: deliveriesTable.driverUserId,
      })
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, createdDelivery.id));

    assert.equal(siteRow.legacyDriver, legacyName);
    assert.equal(deliveryRow.legacyDriver, legacyName);
    assert.equal(siteRow.driverUserId, deliveryRow.driverUserId);
    assert.equal(
      [assignedDriver.id, otherDriver.id].includes(siteRow.driverUserId ?? ""),
      true,
    );
  } finally {
    if (createdSiteId) {
      await db.delete(sitesTable).where(eq(sitesTable.id, createdSiteId));
    }
  }
});

test("логист не может массово загружать график", async () => {
  actor = editor;

  const response = await fetch(`${baseUrl}/deliveries/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [
        {
          siteId,
          driverUserId: null,
          plannedDate: "2026-09-16",
        },
      ],
    }),
  });

  assert.equal(response.status, 403);
});

test("массовая загрузка графика требует водителя-пользователя в каждой строке", async () => {
  actor = admin;

  const response = await fetch(`${baseUrl}/deliveries/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [
        {
          siteId,
          driverUserId: null,
          plannedDate: "2026-09-16",
        },
      ],
    }),
  });

  assert.equal(response.status, 400);
  assert.match(
    String(((await response.json()) as { error?: string }).error),
    /водитель из справочника пользователей/,
  );
});

async function waitForAdvisoryLockWaiter(lockKey: number): Promise<void> {
  for (;;) {
    const waiting = await pool.query<{ waiting: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_locks
          WHERE locktype = 'advisory'
            AND classid = 0
            AND objid = $1
            AND granted = false
        ) AS waiting
      `,
      [lockKey],
    );
    if (waiting.rows[0]?.waiting) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function waitForRowUpdateLockWaiter(): Promise<void> {
  for (;;) {
    const waiting = await pool.query<{ waiting: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_locks
        WHERE locktype IN ('transactionid', 'tuple')
          AND granted = false
      ) AS waiting
    `);
    if (waiting.rows[0]?.waiting) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("создание возвращает 400, если водителя удалили после проверки", async () => {
  actor = editor;
  const lockKey = 196001;
  const triggerName = "test_pause_delivery_driver_create";
  const functionName = "test_pause_delivery_driver_create";
  const driver = testUser("driver");
  await db.insert(appUsersTable).values(driver);
  const blocker = await pool.connect();

  try {
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON deliveries`);
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await pool.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        IF NEW.driver_user_id = '${driver.id}'::uuid THEN
          PERFORM pg_advisory_xact_lock(${lockKey});
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON deliveries
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock($1)", [lockKey]);

    const responsePromise = fetch(`${baseUrl}/deliveries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        siteId,
        driverUserId: driver.id,
        plannedDate: "2035-01-15",
      }),
    });
    await waitForAdvisoryLockWaiter(lockKey);
    await db.delete(appUsersTable).where(eq(appUsersTable.id, driver.id));
    await blocker.query("COMMIT");

    const response = await responsePromise;
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Выбранный пользователь не является водителем",
    });
    const created = await db
      .select({ id: deliveriesTable.id })
      .from(deliveriesTable)
      .where(
        and(
          eq(deliveriesTable.siteId, siteId),
          eq(deliveriesTable.plannedDate, "2035-01-15"),
        ),
      );
    assert.deepEqual(created, []);
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON deliveries`);
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await db.delete(appUsersTable).where(eq(appUsersTable.id, driver.id));
  }
});

test("редактирование возвращает 400 и откатывает поля, если водителя удалили после проверки", async () => {
  actor = editor;
  const lockKey = 196002;
  const triggerName = "test_pause_delivery_driver_update";
  const functionName = "test_pause_delivery_driver_update";
  const driver = testUser("driver");
  await db.insert(appUsersTable).values(driver);
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2035-02-15",
      logisticianNote: "Исходное примечание",
    })
    .returning({ id: deliveriesTable.id });
  const blocker = await pool.connect();

  try {
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON deliveries`);
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await pool.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        IF NEW.driver_user_id = '${driver.id}'::uuid THEN
          PERFORM pg_advisory_xact_lock(${lockKey});
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE UPDATE ON deliveries
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock($1)", [lockKey]);

    const responsePromise = fetch(`${baseUrl}/deliveries/${delivery.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        driverUserId: driver.id,
        logisticianNote: "Не должно сохраниться",
      }),
    });
    await waitForAdvisoryLockWaiter(lockKey);
    await db.delete(appUsersTable).where(eq(appUsersTable.id, driver.id));
    await blocker.query("COMMIT");

    const response = await responsePromise;
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Выбранный пользователь не является водителем",
    });
    const [unchanged] = await db
      .select({
        driverUserId: deliveriesTable.driverUserId,
        logisticianNote: deliveriesTable.logisticianNote,
      })
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, delivery.id));
    assert.deepEqual(unchanged, {
      driverUserId: assignedDriver.id,
      logisticianNote: "Исходное примечание",
    });
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON deliveries`);
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await db.delete(deliveriesTable).where(eq(deliveriesTable.id, delivery.id));
    await db.delete(appUsersTable).where(eq(appUsersTable.id, driver.id));
  }
});

test("создание отгрузки возвращает 400 без частичных записей, если водителя удалили после проверки", async () => {
  actor = editor;
  const lockKey = 197001;
  const triggerName = "test_pause_shipment_driver_create";
  const functionName = "test_pause_shipment_driver_create";
  const driver = testUser("driver");
  const [product] = await db
    .insert(productsTable)
    .values({
      name: `Товар гонки ${randomUUID()}`,
      sku: `race-${randomUUID()}`,
      unit: "шт",
      price: "100",
    })
    .returning({ id: productsTable.id });
  const [order] = await db
    .insert(ordersTable)
    .values({ clientId: integrationClientId, isPaid: true })
    .returning({ id: ordersTable.id });
  await db.insert(orderItemsTable).values({
    orderId: order.id,
    productId: product.id,
    quantity: "10",
    price: "100",
  });
  await db.insert(appUsersTable).values(driver);
  const blocker = await pool.connect();

  try {
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON shipments`);
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await pool.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        IF NEW.driver_user_id = '${driver.id}'::uuid THEN
          PERFORM pg_advisory_xact_lock(${lockKey});
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON shipments
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock($1)", [lockKey]);

    const responsePromise = fetch(`${baseUrl}/shipments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderId: order.id,
        siteId,
        driverUserId: driver.id,
        shipmentDate: "2035-03-15",
        note: "Не должно сохраниться",
        items: [{ productId: product.id, quantity: 2 }],
      }),
    });
    await waitForAdvisoryLockWaiter(lockKey);
    await db.delete(appUsersTable).where(eq(appUsersTable.id, driver.id));
    await blocker.query("COMMIT");

    const response = await responsePromise;
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Выбранный пользователь не является водителем",
    });
    const created = await db
      .select({ id: shipmentsTable.id })
      .from(shipmentsTable)
      .where(eq(shipmentsTable.orderId, order.id));
    assert.deepEqual(created, []);
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON shipments`);
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await db.delete(shipmentsTable).where(eq(shipmentsTable.orderId, order.id));
    await db.delete(ordersTable).where(eq(ordersTable.id, order.id));
    await db.delete(productsTable).where(eq(productsTable.id, product.id));
    await db.delete(appUsersTable).where(eq(appUsersTable.id, driver.id));
  }
});

test("редактирование отгрузки возвращает 400 и откатывает изменения, если водителя удалили после проверки", async () => {
  actor = editor;
  const lockKey = 197002;
  const triggerName = "test_pause_shipment_driver_update";
  const functionName = "test_pause_shipment_driver_update";
  const driver = testUser("driver");
  const [product] = await db
    .insert(productsTable)
    .values({
      name: `Товар гонки ${randomUUID()}`,
      sku: `race-${randomUUID()}`,
      unit: "шт",
      price: "100",
    })
    .returning({ id: productsTable.id });
  const [order] = await db
    .insert(ordersTable)
    .values({ clientId: integrationClientId, isPaid: true })
    .returning({ id: ordersTable.id });
  await db.insert(orderItemsTable).values({
    orderId: order.id,
    productId: product.id,
    quantity: "10",
    price: "100",
  });
  const [shipment] = await db
    .insert(shipmentsTable)
    .values({
      orderId: order.id,
      siteId,
      driverUserId: assignedDriver.id,
      shipmentDate: "2035-04-15",
      note: "Исходное примечание",
    })
    .returning({ id: shipmentsTable.id });
  await db.insert(shipmentItemsTable).values({
    shipmentId: shipment.id,
    productId: product.id,
    quantity: "1",
  });
  await db.insert(movementsTable).values({
    shipmentId: shipment.id,
    productId: product.id,
    type: "out",
    quantity: "1",
    note: "Исходное примечание",
  });
  await db.insert(appUsersTable).values(driver);
  const blocker = await pool.connect();

  try {
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON shipments`);
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await pool.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        IF NEW.driver_user_id = '${driver.id}'::uuid THEN
          PERFORM pg_advisory_xact_lock(${lockKey});
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE UPDATE ON shipments
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock($1)", [lockKey]);

    const responsePromise = fetch(`${baseUrl}/shipments/${shipment.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        driverUserId: driver.id,
        note: "Не должно сохраниться",
        items: [{ productId: product.id, quantity: 2 }],
      }),
    });
    await waitForAdvisoryLockWaiter(lockKey);
    await db.delete(appUsersTable).where(eq(appUsersTable.id, driver.id));
    await blocker.query("COMMIT");

    const response = await responsePromise;
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Выбранный пользователь не является водителем",
    });
    const [unchanged] = await db
      .select({
        driverUserId: shipmentsTable.driverUserId,
        note: shipmentsTable.note,
      })
      .from(shipmentsTable)
      .where(eq(shipmentsTable.id, shipment.id));
    assert.deepEqual(unchanged, {
      driverUserId: assignedDriver.id,
      note: "Исходное примечание",
    });
    const items = await db
      .select({ quantity: shipmentItemsTable.quantity })
      .from(shipmentItemsTable)
      .where(eq(shipmentItemsTable.shipmentId, shipment.id));
    assert.deepEqual(items, [{ quantity: "1.00" }]);
    const movements = await db
      .select({ quantity: movementsTable.quantity, note: movementsTable.note })
      .from(movementsTable)
      .where(eq(movementsTable.shipmentId, shipment.id));
    assert.deepEqual(movements, [
      { quantity: "1.00", note: "Исходное примечание" },
    ]);
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON shipments`);
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await db.delete(shipmentsTable).where(eq(shipmentsTable.id, shipment.id));
    await db.delete(ordersTable).where(eq(ordersTable.id, order.id));
    await db.delete(productsTable).where(eq(productsTable.id, product.id));
    await db.delete(appUsersTable).where(eq(appUsersTable.id, driver.id));
  }
});

test("доставка без даты создаётся, попадает в месяц, но исключается фильтром дат", async () => {
  actor = admin;
  const created = await fetch(`${baseUrl}/deliveries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: null,
      scheduleMonth: "2031-04",
    }),
  });
  assert.equal(created.status, 201);
  const body = (await created.json()) as {
    id: string;
    plannedDate: string | null;
    scheduleMonth: string | null;
    status: string;
    lagDays: number | null;
    workflowStatus: string;
  };
  assert.equal(body.plannedDate, null);
  assert.equal(body.scheduleMonth, "2031-04");
  assert.equal(body.status, "pending");
  assert.equal(body.lagDays, null);
  assert.equal(body.workflowStatus, "planned");

  const monthList = await fetch(
    `${baseUrl}/deliveries?month=2031-04&siteId=${siteId}`,
  );
  assert.equal(monthList.status, 200);
  assert.equal(
    ((await monthList.json()) as Array<{ id: string }>).some(
      (row) => row.id === body.id,
    ),
    true,
  );

  const dateList = await fetch(
    `${baseUrl}/deliveries?dateFrom=2031-04-01&dateTo=2031-04-30&siteId=${siteId}`,
  );
  assert.equal(dateList.status, 200);
  assert.equal(
    ((await dateList.json()) as Array<{ id: string }>).some(
      (row) => row.id === body.id,
    ),
    false,
  );
});

test("дате доставки без даты можно назначить день только в её месяце", async () => {
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: null,
      scheduleMonth: "2031-05",
    })
    .returning({ id: deliveriesTable.id });
  actor = editor;

  const outside = await fetch(`${baseUrl}/deliveries/${delivery.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plannedDate: "2031-06-01" }),
  });
  assert.equal(outside.status, 400);

  const assigned = await fetch(`${baseUrl}/deliveries/${delivery.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plannedDate: "2031-05-17" }),
  });
  assert.equal(assigned.status, 200);
  const body = (await assigned.json()) as {
    plannedDate: string | null;
    scheduleMonth: string | null;
  };
  assert.equal(body.plannedDate?.slice(0, 10), "2031-05-17");
  assert.equal(body.scheduleMonth, "2031-05");
});

test("очистка даты legacy-строки сохраняет её месяц графика", async () => {
  const [legacy] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2031-07-12",
      scheduleMonth: null,
    })
    .returning({ id: deliveriesTable.id });
  actor = editor;

  const cleared = await fetch(`${baseUrl}/deliveries/${legacy.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plannedDate: null }),
  });
  assert.equal(cleared.status, 200);
  const body = (await cleared.json()) as {
    plannedDate: string | null;
    scheduleMonth: string | null;
  };
  assert.equal(body.plannedDate, null);
  assert.equal(body.scheduleMonth, "2031-07");

  const monthList = await fetch(
    `${baseUrl}/deliveries?month=2031-07&siteId=${siteId}`,
  );
  assert.equal(
    ((await monthList.json()) as Array<{ id: string }>).some(
      (row) => row.id === legacy.id,
    ),
    true,
  );
});

test("водитель не может отметить доставку без даты выполненной", async () => {
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: null,
      scheduleMonth: "2031-06",
    })
    .returning({ id: deliveriesTable.id });
  actor = assignedDriver;

  const response = await fetch(`${baseUrl}/my/deliveries/${delivery.id}/done`, {
    method: "POST",
  });
  assert.equal(response.status, 409);
  assert.match(
    String(((await response.json()) as { error?: string }).error),
    /плановую дату/,
  );
});

test("замена месяца сохраняет строки без даты и не затрагивает другой месяц", async () => {
  const [preserved, replaced, otherMonth] = await db
    .insert(deliveriesTable)
    .values([
      {
        siteId,
        driverUserId: assignedDriver.id,
        plannedDate: null,
        scheduleMonth: "2032-04",
      },
      {
        siteId,
        driverUserId: assignedDriver.id,
        plannedDate: "2032-04-03",
        scheduleMonth: "2032-04",
      },
      {
        siteId,
        driverUserId: assignedDriver.id,
        plannedDate: null,
        scheduleMonth: "2032-05",
      },
    ])
    .returning({ id: deliveriesTable.id });
  actor = admin;

  const response = await fetch(`${baseUrl}/deliveries/bulk/replace`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      month: "2032-04",
      items: [
        { siteId, driverUserId: assignedDriver.id, plannedDate: null },
        { siteId, driverUserId: assignedDriver.id, plannedDate: "2032-04-20" },
      ],
    }),
  });
  assert.equal(response.status, 201);

  const rows = await db
    .select()
    .from(deliveriesTable)
    .where(
      inArray(deliveriesTable.id, [preserved.id, replaced.id, otherMonth.id]),
    );
  assert.equal(
    rows.some((row) => row.id === preserved.id),
    true,
  );
  assert.equal(
    rows.some((row) => row.id === replaced.id),
    false,
  );
  assert.equal(
    rows.some((row) => row.id === otherMonth.id),
    true,
  );
  const aprilUndated = await db
    .select()
    .from(deliveriesTable)
    .where(
      and(
        eq(deliveriesTable.siteId, siteId),
        eq(deliveriesTable.scheduleMonth, "2032-04"),
        isNull(deliveriesTable.plannedDate),
      ),
    );
  assert.equal(aprilUndated.length, 1);
});

test("замена месяца не вставляет повторяющиеся строки с одинаковой датой", async () => {
  actor = admin;
  const response = await fetch(`${baseUrl}/deliveries/bulk/replace`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      month: "2032-06",
      items: [
        { siteId, driverUserId: assignedDriver.id, plannedDate: "2032-06-20" },
        { siteId, driverUserId: assignedDriver.id, plannedDate: "2032-06-20" },
      ],
    }),
  });
  assert.equal(response.status, 201);
  assert.equal(((await response.json()) as Array<unknown>).length, 1);
  const rows = await db
    .select()
    .from(deliveriesTable)
    .where(
      and(
        eq(deliveriesTable.siteId, siteId),
        eq(deliveriesTable.scheduleMonth, "2032-06"),
        eq(deliveriesTable.plannedDate, "2032-06-20"),
      ),
    );
  assert.equal(rows.length, 1);
});

test("маршрут скрывает чужие акты и разрешает их назначенному водителю", async () => {
  actor = otherDriver;
  const forbidden = await fetch(`${baseUrl}/deliveries/${deliveryId}/photos`);
  assert.equal(forbidden.status, 403);

  actor = assignedDriver;
  const allowed = await fetch(`${baseUrl}/deliveries/${deliveryId}/photos`);
  assert.equal(allowed.status, 200);
  const photos = (await allowed.json()) as Array<{ id: string }>;
  assert.equal(
    photos.some((photo: { id: string }) => photo.id === photoId),
    true,
  );
});

test("список водителя содержит адрес объекта", async () => {
  actor = assignedDriver;
  const params = new URLSearchParams({
    from: "2026-09-15",
    to: "2026-09-15",
    search: "Тестовый адрес",
  });
  const response = await fetch(`${baseUrl}/my/deliveries?${params}`);
  assert.equal(response.status, 200);
  const deliveries = (await response.json()) as Array<{
    id: string;
    siteAddress: string;
  }>;
  assert.equal(
    deliveries.find((delivery) => delivery.id === deliveryId)?.siteAddress,
    "Тестовый адрес",
  );
});

test("сводка назначенных объектов принимает даты YYYY-MM-DD и отклоняет другой формат", async () => {
  actor = { ...assignedDriver, assignedSiteIds: [siteId] };
  const params = new URLSearchParams({
    from: "2026-09-15",
    to: "2026-09-15",
  });

  const response = await fetch(`${baseUrl}/my/sites-summary?${params}`);
  assert.equal(response.status, 200);
  const summary = (await response.json()) as Array<{
    siteId: string;
    address: string;
    driverUserId: string | null;
    planned: number;
    done: number;
  }>;
  const assignedSite = summary.find((site) => site.siteId === siteId);
  assert.ok(assignedSite);
  assert.equal(assignedSite.address, "Тестовый адрес");
  assert.equal(assignedSite.driverUserId, assignedDriver.id);
  assert.equal(assignedSite.planned, 1);
  assert.equal(assignedSite.done, 1);

  const invalid = await fetch(
    `${baseUrl}/my/sites-summary?from=2026%2F09%2F15&to=2026-09-15`,
  );
  assert.equal(invalid.status, 400);
});

test("список водителя не содержит доставку другого водителя", async () => {
  actor = otherDriver;
  const response = await fetch(`${baseUrl}/my/deliveries`);
  assert.equal(response.status, 200);
  const deliveries = (await response.json()) as Array<{ id: string }>;
  assert.equal(
    deliveries.some((delivery) => delivery.id === deliveryId),
    false,
  );
});

test("только назначенный активный водитель изменяет свой комментарий", async () => {
  actor = otherDriver;
  const forbidden = await fetch(
    `${baseUrl}/my/deliveries/${deliveryId}/comment`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "чужой комментарий" }),
    },
  );
  assert.equal(forbidden.status, 403);

  actor = assignedDriver;
  const allowed = await fetch(
    `${baseUrl}/my/deliveries/${deliveryId}/comment`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "комментарий водителя" }),
    },
  );
  assert.equal(allowed.status, 200);
  assert.equal(
    ((await allowed.json()) as { note: string | null }).note,
    "комментарий водителя",
  );
});

test("изменение комментария отсутствующей доставки возвращает 404", async () => {
  actor = assignedDriver;
  const response = await fetch(
    `${baseUrl}/my/deliveries/${randomUUID()}/comment`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "комментарий к удалённой доставке" }),
    },
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Доставка не найдена",
  });
});

test("логист изменяет только своё примечание, а водитель видит оба поля", async () => {
  actor = editor;
  const noteResponse = await fetch(`${baseUrl}/deliveries/${deliveryId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ logisticianNote: "уточнение от логиста" }),
  });
  assert.equal(noteResponse.status, 200);
  const updated = (await noteResponse.json()) as {
    note: string | null;
    logisticianNote: string | null;
  };
  assert.equal(updated.note, "комментарий водителя");
  assert.equal(updated.logisticianNote, "уточнение от логиста");

  const driverCommentAttempt = await fetch(
    `${baseUrl}/deliveries/${deliveryId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "логист не должен это менять" }),
    },
  );
  assert.equal(driverCommentAttempt.status, 400);

  actor = admin;
  const adminNoteAttempt = await fetch(`${baseUrl}/deliveries/${deliveryId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ logisticianNote: "примечание администратора" }),
  });
  assert.equal(adminNoteAttempt.status, 403);

  actor = assignedDriver;
  const driverList = await fetch(`${baseUrl}/my/deliveries`);
  assert.equal(driverList.status, 200);
  const driverDelivery = (
    (await driverList.json()) as Array<{
      id: string;
      note: string | null;
      logisticianNote: string | null;
    }>
  ).find((delivery) => delivery.id === deliveryId);
  assert.ok(driverDelivery);
  assert.equal(driverDelivery.note, "комментарий водителя");
  assert.equal(driverDelivery.logisticianNote, "уточнение от логиста");
});

test("отметка водителя о выполнении не закрывает доставку", async () => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: today,
    })
    .returning({ id: deliveriesTable.id });

  actor = assignedDriver;
  const response = await fetch(`${baseUrl}/my/deliveries/${delivery.id}/done`, {
    method: "POST",
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    actualDate: string | null;
    actApprovedAt: string | null;
    actApprovedBy: string | null;
    workflowStatus: string;
  };
  assert.equal(body.actualDate?.slice(0, 10), today);
  assert.equal(body.actApprovedAt, null);
  assert.equal(body.actApprovedBy, null);
  assert.equal(body.workflowStatus, "done");
});

test("назначенный раздел даёт только необходимые справочники, а не соседние разделы", async () => {
  const features = "Разгрузка только с торца, фура до 12 м";
  actor = testUser("logistician", { editableSections: ["sites"] });
  const updatedSite = await fetch(`${baseUrl}/sites/${siteId}/features`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      features,
    }),
  });
  assert.equal(updatedSite.status, 200);
  assert.equal(
    ((await updatedSite.json()) as { features: string }).features,
    features,
  );

  actor = manager;

  const fullSites = await fetch(`${baseUrl}/sites`);
  assert.equal(fullSites.status, 403);
  const fullSitesMixedCase = await fetch(`${baseUrl}/SITES`);
  assert.equal(fullSitesMixedCase.status, 403);

  const [siteWithoutManagerContact] = await db
    .insert(sitesTable)
    .values({
      name: `Объект без контакта ${randomUUID()}`,
      address: "Тестовый адрес",
      branch: "Тестовый куст",
      client: integrationClientName,
      clientId: integrationClientId,
      manager: "Тестовый менеджер",
      director: "Тестовый руководитель",
      project: "Тестовый проект",
    })
    .returning({ id: sitesTable.id });
  try {
    const deliverySites = await fetch(`${baseUrl}/deliveries/site-lookup`);
    assert.equal(deliverySites.status, 200);
    const deliverySiteRows = (await deliverySites.json()) as Array<
      Record<string, unknown>
    >;
    const ownSite = deliverySiteRows.find((row) => row.id === siteId);
    assert.ok(ownSite);
    assert.equal(ownSite.features, features);
    assert.equal(ownSite.managerContact, "+7 999 123-45-67");
    assert.deepEqual(Object.keys(ownSite).sort(), [
      "address",
      "branch",
      "client",
      "deliveryType",
      "driver",
      "driverUserId",
      "features",
      "id",
      "isClosed",
      "manager",
      "managerContact",
      "name",
    ]);
    const rowWithoutManagerContact = deliverySiteRows.find(
      (row) => row.id === siteWithoutManagerContact.id,
    );
    assert.ok(rowWithoutManagerContact);
    assert.equal(rowWithoutManagerContact.managerContact, "");
  } finally {
    await db
      .delete(sitesTable)
      .where(eq(sitesTable.id, siteWithoutManagerContact.id));
  }

  actor = testUser("manager", { editableSections: ["shipments"] });
  const fullOrders = await fetch(`${baseUrl}/orders`);
  assert.equal(fullOrders.status, 403);
  const fullOrdersMixedCase = await fetch(`${baseUrl}/ORDERS`);
  assert.equal(fullOrdersMixedCase.status, 403);

  const shipmentOrders = await fetch(`${baseUrl}/lookups/shipment-orders`);
  assert.equal(shipmentOrders.status, 200);
  assert.ok(Array.isArray(await shipmentOrders.json()));

  actor = testUser("logistician", { editableSections: ["inventory"] });
  const inventorySites = await fetch(`${baseUrl}/lookups/inventory-sites`);
  assert.equal(inventorySites.status, 200);
  assert.ok(Array.isArray(await inventorySites.json()));

  const officeMyRoute = await fetch(`${baseUrl}/MY/deliveries`);
  assert.equal(officeMyRoute.status, 403);
});

test("подтверждение акта требует факт и файл, закрывает доставку и защищено правами", async () => {
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2026-09-20",
    })
    .returning({ id: deliveriesTable.id });

  actor = manager;
  const withoutDone = await fetch(
    `${baseUrl}/deliveries/${delivery.id}/approve-act`,
    {
      method: "POST",
    },
  );
  assert.equal(withoutDone.status, 409);

  await db
    .update(deliveriesTable)
    .set({ actualDate: "2026-09-20" })
    .where(eq(deliveriesTable.id, delivery.id));
  const withoutPhoto = await fetch(
    `${baseUrl}/deliveries/${delivery.id}/approve-act`,
    {
      method: "POST",
    },
  );
  assert.equal(withoutPhoto.status, 409);

  const [photo] = await db
    .insert(deliveryPhotosTable)
    .values({
      deliveryId: delivery.id,
      objectPath: `/objects/uploads/${randomUUID()}`,
      fileName: "акт-для-подтверждения.pdf",
      mimeType: "application/pdf",
      uploadedBy: "Интеграционный тест",
    })
    .returning();

  const managerUploadUrl = await fetch(
    `${baseUrl}/storage/uploads/request-url`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "акт.pdf",
        size: 1024,
        contentType: "application/pdf",
        deliveryId: delivery.id,
      }),
    },
  );
  assert.equal(managerUploadUrl.status, 403);

  const managerPhotos = await fetch(
    `${baseUrl}/deliveries/${delivery.id}/photos`,
  );
  assert.equal(managerPhotos.status, 200);

  const managerUpload = await fetch(
    `${baseUrl}/deliveries/${delivery.id}/photos`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        objectPath: photo.objectPath,
        fileName: "руководитель-не-может-загрузить.pdf",
        mimeType: "application/pdf",
      }),
    },
  );
  assert.equal(managerUpload.status, 403);
  assert.equal(deletedObjectPaths.includes(photo.objectPath), false);

  actor = assignedDriver;
  const malformedUpload = await fetch(
    `${baseUrl}/deliveries/${delivery.id}/photos`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objectPath: photo.objectPath }),
    },
  );
  assert.equal(malformedUpload.status, 400);
  assert.equal(deletedObjectPaths.includes(photo.objectPath), false);

  actor = otherDriver;
  const forbidden = await fetch(
    `${baseUrl}/deliveries/${delivery.id}/approve-act`,
    {
      method: "POST",
    },
  );
  assert.equal(forbidden.status, 403);

  actor = manager;
  const approved = await fetch(
    `${baseUrl}/deliveries/${delivery.id}/approve-act`,
    {
      method: "POST",
    },
  );
  assert.equal(approved.status, 200);
  const body = (await approved.json()) as {
    actApprovedAt: string | null;
    actApprovedBy: string | null;
    workflowStatus: string;
  };
  assert.ok(body.actApprovedAt);
  assert.equal(body.actApprovedBy, manager.id);
  assert.equal(body.workflowStatus, "closed");

  actor = assignedDriver;
  const closedComment = await fetch(
    `${baseUrl}/my/deliveries/${delivery.id}/comment`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "нельзя менять закрытый акт" }),
    },
  );
  assert.equal(closedComment.status, 409);
  assert.match(
    String(((await closedComment.json()) as { error?: string }).error),
    /закрыта/,
  );

  const rejectedObjectPath = `/objects/uploads/${randomUUID()}`;
  const rejectedUpload = await fetch(
    `${baseUrl}/deliveries/${delivery.id}/photos`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        objectPath: rejectedObjectPath,
        fileName: "новый-акт.pdf",
        mimeType: "application/pdf",
      }),
    },
  );
  assert.equal(rejectedUpload.status, 409);
  const [stillClosed] = await db
    .select({
      actApprovedAt: deliveriesTable.actApprovedAt,
    })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, delivery.id));
  assert.ok(stillClosed.actApprovedAt);

  actor = editor;
  const deleted = await fetch(`${baseUrl}/delivery-photos/${photo.id}`, {
    method: "DELETE",
  });
  assert.equal(deleted.status, 204);
  const [afterDelete] = await db
    .select({
      actApprovedAt: deliveriesTable.actApprovedAt,
      actApprovedBy: deliveriesTable.actApprovedBy,
    })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, delivery.id));
  assert.equal(afterDelete.actApprovedAt, null);
  assert.equal(afterDelete.actApprovedBy, null);
});

test("руководитель доставок не может редактировать доставку", async () => {
  actor = manager;
  const response = await fetch(`${baseUrl}/deliveries/${deliveryId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note: "запрещённое изменение" }),
  });
  assert.equal(response.status, 403);
});

test("маршрут отклоняет повторное прикрепление одного объекта", async () => {
  actor = editor;
  const response = await fetch(`${baseUrl}/deliveries/${deliveryId}/photos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      objectPath: duplicateObjectPath,
      fileName: "акт-дубль.pdf",
      mimeType: "application/pdf",
    }),
  });
  assert.equal(response.status, 409);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /уже прикреплён/);
});

test("маршрут не удаляет объект без подтверждённого права на доставку", async () => {
  actor = editor;
  const objectPath = `/objects/uploads/${randomUUID()}`;
  const response = await fetch(`${baseUrl}/deliveries/${randomUUID()}/photos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      objectPath,
      fileName: "лишний-акт.pdf",
      mimeType: "application/pdf",
    }),
  });

  assert.equal(response.status, 404);
  assert.equal(deletedObjectPaths.includes(objectPath), false);
});

test("маршрут очищает безопасный upload-путь при невалидном теле", async () => {
  actor = editor;
  const objectPath = `/objects/uploads/${randomUUID()}`;
  const response = await fetch(`${baseUrl}/deliveries/${deliveryId}/photos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      objectPath,
      mimeType: "application/pdf",
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(deletedObjectPaths.includes(objectPath), true);
});

test("водитель не может удалить акт, а редактор может", async () => {
  actor = assignedDriver;
  const forbidden = await fetch(`${baseUrl}/delivery-photos/${photoId}`, {
    method: "DELETE",
  });
  assert.equal(forbidden.status, 403);

  actor = editor;
  const deleted = await fetch(`${baseUrl}/delivery-photos/${photoId}`, {
    method: "DELETE",
  });
  assert.equal(deleted.status, 204);
  assert.equal(deletedObjectPaths.includes(duplicateObjectPath), true);

  const [remaining] = await db
    .select({ id: deliveryPhotosTable.id })
    .from(deliveryPhotosTable)
    .where(eq(deliveryPhotosTable.id, photoId));
  assert.equal(remaining, undefined);

  const alreadyDeleted = await fetch(`${baseUrl}/delivery-photos/${photoId}`, {
    method: "DELETE",
  });
  assert.equal(alreadyDeleted.status, 404);
  assert.deepEqual(await alreadyDeleted.json(), {
    error: "Акт не найден",
  });
});

test("при ошибке хранилища акт остаётся в базе", async () => {
  actor = editor;
  const objectPath = `/objects/uploads/${randomUUID()}`;
  const [photo] = await db
    .insert(deliveryPhotosTable)
    .values({
      deliveryId,
      objectPath,
      fileName: "акт-с-ошибкой.pdf",
      mimeType: "application/pdf",
      uploadedBy: "Интеграционный тест",
    })
    .returning({ id: deliveryPhotosTable.id });

  storageDeleteError = new Error("storage unavailable");
  const response = await fetch(`${baseUrl}/delivery-photos/${photo.id}`, {
    method: "DELETE",
  });
  storageDeleteError = null;

  assert.equal(response.status, 502);
  const [remaining] = await db
    .select({ id: deliveryPhotosTable.id })
    .from(deliveryPhotosTable)
    .where(eq(deliveryPhotosTable.id, photo.id));
  assert.equal(remaining?.id, photo.id);

  await db
    .delete(deliveryPhotosTable)
    .where(eq(deliveryPhotosTable.id, photo.id));
});

test("automatic cleanup сохраняет обе ошибки при сбое cleanup и PostgreSQL-записи failed-статуса", async () => {
  const cleanupError = new Error("injected automatic cleanup failure");
  const triggerMessage = "injected automatic cleanup status write failure";
  const writeStatus = createAutomaticCleanupStatusWriter(
    async ({ insert, update }) => {
      await db.transaction(async (tx) => {
        await acquireDeliveryUploadCleanupStatusLock(tx);
        await tx
          .insert(deliveryUploadCleanupStatusTable)
          .values(insert)
          .onConflictDoUpdate({
            target: deliveryUploadCleanupStatusTable.key,
            set: update,
          });
      });
    },
  );
  const recordRun = createAutomaticCleanupRunRecorder({
    runCleanup: async () => {
      throw cleanupError;
    },
    writeStatus,
  });

  await db.execute(sql`
    create or replace function test_fail_automatic_cleanup_failed_status()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.key = 'automatic' and new.status = 'failed' then
        raise exception 'injected automatic cleanup status write failure';
      end if;
      return new;
    end;
    $$
  `);
  await db.execute(sql`
    create trigger test_fail_automatic_cleanup_failed_status_trigger
    before insert or update on delivery_upload_cleanup_status
    for each row execute function test_fail_automatic_cleanup_failed_status()
  `);

  try {
    await assert.rejects(recordRun(), (error) => {
      assert.ok(error instanceof AutomaticCleanupStatusRecordingError);
      assert.strictEqual(error.cause, cleanupError);
      assert.ok(error.statusWriteError instanceof Error);
      const postgresError = error.statusWriteError.cause;
      assert.ok(postgresError instanceof Error);
      assert.match(postgresError.message, new RegExp(triggerMessage));
      assert.equal((postgresError as Error & { code?: string }).code, "P0001");
      return true;
    });
  } finally {
    await db.execute(sql`
      drop trigger if exists test_fail_automatic_cleanup_failed_status_trigger
      on delivery_upload_cleanup_status
    `);
    await db.execute(
      sql`drop function if exists test_fail_automatic_cleanup_failed_status()`,
    );
  }
});

test("automatic cleanup считает серию сбоев реальным PostgreSQL upsert и сбрасывает её после успеха", async () => {
  const firstSuccessAt = new Date("2026-09-01T06:00:00.000Z");
  const firstFailureAt = new Date("2026-09-02T06:00:00.000Z");
  const secondFailureAt = new Date("2026-09-03T06:00:00.000Z");
  const recoveredAt = new Date("2026-09-04T06:00:00.000Z");
  const summary = {
    scanned: 0,
    candidates: 0,
    deleted: 0,
    resumedPhotoDeletions: 0,
    resumedDeliveryDeletions: 0,
    failed: 0,
  };

  await db.transaction(async (tx) => {
    await acquireDeliveryUploadCleanupStatusLock(tx);
    const [previousStatus] = await tx
      .select()
      .from(deliveryUploadCleanupStatusTable)
      .where(eq(deliveryUploadCleanupStatusTable.key, "automatic"))
      .limit(1);
    const writeStatus = createAutomaticCleanupStatusWriter(
      async ({ insert, update }) => {
        await tx
          .insert(deliveryUploadCleanupStatusTable)
          .values(insert)
          .onConflictDoUpdate({
            target: deliveryUploadCleanupStatusTable.key,
            set: update,
          });
      },
    );
    const readStatus = async () => {
      const [status] = await tx
        .select()
        .from(deliveryUploadCleanupStatusTable)
        .where(eq(deliveryUploadCleanupStatusTable.key, "automatic"))
        .limit(1);
      assert.ok(status);
      return status;
    };

    try {
      await writeStatus({
        lastRunAt: firstSuccessAt,
        lastSuccessfulRunAt: firstSuccessAt,
        status: "success",
        failureKind: "none",
        summary,
      });

      await writeStatus({
        lastRunAt: firstFailureAt,
        status: "failed",
        failureKind: "list_timeout",
        summary: { ...summary, failed: 1 },
      });
      const firstFailure = await readStatus();
      assert.equal(firstFailure.failureKind, "list_timeout");
      assert.equal(firstFailure.consecutiveFailures, 1);
      assert.equal(
        firstFailure.lastSuccessfulRunAt?.getTime(),
        firstSuccessAt.getTime(),
      );

      await writeStatus({
        lastRunAt: secondFailureAt,
        status: "failed",
        failureKind: "list_timeout",
        summary: { ...summary, failed: 1 },
      });
      const secondFailure = await readStatus();
      assert.equal(secondFailure.failureKind, "list_timeout");
      assert.equal(secondFailure.consecutiveFailures, 2);
      assert.equal(
        secondFailure.lastSuccessfulRunAt?.getTime(),
        firstSuccessAt.getTime(),
      );

      await writeStatus({
        lastRunAt: recoveredAt,
        lastSuccessfulRunAt: recoveredAt,
        status: "success",
        failureKind: "none",
        summary,
      });
      const recovered = await readStatus();
      assert.equal(recovered.failureKind, "none");
      assert.equal(recovered.consecutiveFailures, 0);
      assert.equal(
        recovered.lastSuccessfulRunAt?.getTime(),
        recoveredAt.getTime(),
      );
    } finally {
      await tx
        .delete(deliveryUploadCleanupStatusTable)
        .where(eq(deliveryUploadCleanupStatusTable.key, "automatic"));
      if (previousStatus) {
        await tx
          .insert(deliveryUploadCleanupStatusTable)
          .values(previousStatus);
      }
    }
  });
});

test("cleanup завершает tombstone после сбоя БД уже удалённого файла", async () => {
  actor = editor;
  const objectPath = `/objects/uploads/${randomUUID()}`;
  const deleteResultOffset = storageDeleteResults.length;
  const [photo] = await db
    .insert(deliveryPhotosTable)
    .values({
      deliveryId,
      objectPath,
      fileName: "test-db-failure-after-storage-delete",
      mimeType: "application/pdf",
      uploadedBy: "Интеграционный тест",
    })
    .returning({ id: deliveryPhotosTable.id });

  await db.execute(sql`
    create or replace function test_fail_delivery_photo_delete()
    returns trigger
    language plpgsql
    as $$
    begin
      if old.file_name = 'test-db-failure-after-storage-delete' then
        raise exception 'injected delivery_photos delete failure';
      end if;
      return old;
    end;
    $$
  `);
  await db.execute(sql`
    create trigger test_fail_delivery_photo_delete_trigger
    before delete on delivery_photos
    for each row execute function test_fail_delivery_photo_delete()
  `);

  try {
    const failedResponse = await fetch(
      `${baseUrl}/delivery-photos/${photo.id}`,
      { method: "DELETE" },
    );
    assert.equal(failedResponse.status, 500);
    assert.equal(deletedObjectPaths.includes(objectPath), true);

    const [tombstone] = await db
      .select({
        id: deliveryPhotosTable.id,
        deletionPendingAt: deliveryPhotosTable.deletionPendingAt,
      })
      .from(deliveryPhotosTable)
      .where(eq(deliveryPhotosTable.id, photo.id));
    assert.equal(tombstone?.id, photo.id);
    assert.ok(tombstone.deletionPendingAt);

    const listedResponse = await fetch(
      `${baseUrl}/deliveries/${deliveryId}/photos`,
    );
    assert.equal(listedResponse.status, 200);
    const listed = (await listedResponse.json()) as Array<{ id: string }>;
    assert.equal(
      listed.some((item) => item.id === photo.id),
      false,
    );
  } finally {
    await db.execute(
      sql`drop trigger if exists test_fail_delivery_photo_delete_trigger on delivery_photos`,
    );
    await db.execute(
      sql`drop function if exists test_fail_delivery_photo_delete()`,
    );
  }

  const cleanupDependenciesWithoutListedObjects =
    createProductionDeliveryUploadCleanupDependencies(
      db,
      deliveriesTable,
      deliveryPhotosTable,
      {
        listPrivateUploadObjects: async () => [],
        deleteObjectEntity: (path) =>
          new ObjectStorageService().deleteObjectEntity(path),
      },
      cleanupLogger,
    );
  const firstRetry = await runLiveDeliveryUploadCleanup(
    cleanupDependenciesWithoutListedObjects,
  );
  assert.ok(firstRetry);
  assert.equal(firstRetry.resumedPhotoDeletions, 1);
  assert.equal(firstRetry.resumedDeliveryDeletions, 0);
  assert.deepEqual(storageDeleteResults.slice(deleteResultOffset), [
    { objectPath, deleted: true },
    { objectPath, deleted: false },
  ]);
  const [remaining] = await db
    .select({ id: deliveryPhotosTable.id })
    .from(deliveryPhotosTable)
    .where(eq(deliveryPhotosTable.id, photo.id));
  assert.equal(remaining, undefined);

  const secondRetry = await runLiveDeliveryUploadCleanup(
    cleanupDependenciesWithoutListedObjects,
  );
  assert.ok(secondRetry);
});

test("cleanup сохраняет tombstone при отказе соединения на финальном commit", async () => {
  const objectPath = `/objects/uploads/${randomUUID()}`;
  const pendingAt = new Date();
  const [photo] = await db
    .insert(deliveryPhotosTable)
    .values({
      deliveryId,
      objectPath,
      fileName: "test-commit-failure-after-storage-delete",
      mimeType: "application/pdf",
      uploadedBy: "Интеграционный тест",
      deletionPendingAt: pendingAt,
    })
    .returning({ id: deliveryPhotosTable.id });
  const attemptedPaths: string[] = [];
  let cleanupClientClosed = false;
  let finalCommitAttempted = false;
  let armFinalCommitFailure: () => void = () => {
    throw new Error("cleanup connection was not initialized");
  };

  const dependencies = createProductionDeliveryUploadCleanupDependencies(
    db,
    deliveriesTable,
    deliveryPhotosTable,
    {
      listPrivateUploadObjects: async () => [],
      deleteObjectEntity: async (path) => {
        attemptedPaths.push(path);
        armFinalCommitFailure();
        return true;
      },
    },
    cleanupLogger,
  );
  dependencies.runWithGlobalCleanupLock = async (callback) => {
    const client = await pool.connect();
    let commitFailureArmed = false;
    armFinalCommitFailure = () => {
      commitFailureArmed = true;
    };
    const databaseClient = new Proxy(client, {
      get(target, property, receiver) {
        if (property !== "query") {
          return Reflect.get(target, property, receiver);
        }
        return (...args: unknown[]) => {
          const query = args[0];
          const queryText =
            typeof query === "string"
              ? query
              : query &&
                  typeof query === "object" &&
                  "text" in query &&
                  typeof query.text === "string"
                ? query.text
                : "";
          if (commitFailureArmed && /^commit\b/i.test(queryText.trim())) {
            commitFailureArmed = false;
            finalCommitAttempted = true;
            cleanupClientClosed = true;
            client.release(
              new Error("injected connection failure during final commit"),
            );
          }
          return Reflect.apply(client.query, client, args);
        };
      },
    });
    let acquired = false;
    try {
      acquired = await tryAcquireDeliveryUploadCleanupSessionLock(client);
      assert.equal(acquired, true);
      return await callback(drizzle(databaseClient as never));
    } finally {
      armFinalCommitFailure = () => {
        throw new Error("cleanup connection was already released");
      };
      if (!cleanupClientClosed) {
        if (acquired) {
          await releaseDeliveryUploadCleanupSessionLock(client);
        }
        client.release();
      }
    }
  };

  await assert.rejects(runLiveDeliveryUploadCleanup(dependencies), (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Failed query/);
    assert.ok(error.cause instanceof Error);
    assert.match(error.cause.message, /Client was closed and is not queryable/);
    return true;
  });
  assert.equal(finalCommitAttempted, true);
  assert.deepEqual(attemptedPaths, [objectPath]);

  const [tombstone] = await db
    .select({
      id: deliveryPhotosTable.id,
      deletionPendingAt: deliveryPhotosTable.deletionPendingAt,
    })
    .from(deliveryPhotosTable)
    .where(eq(deliveryPhotosTable.id, photo.id));
  assert.equal(tombstone?.id, photo.id);
  assert.ok(tombstone.deletionPendingAt);

  const listedResponse = await fetch(
    `${baseUrl}/deliveries/${deliveryId}/photos`,
  );
  assert.equal(listedResponse.status, 200);
  const listed = (await listedResponse.json()) as Array<{ id: string }>;
  assert.equal(
    listed.some((item) => item.id === photo.id),
    false,
  );

  const recoveryAttempts: string[] = [];
  const recoverySummary = await runLiveDeliveryUploadCleanup(
    createProductionDeliveryUploadCleanupDependencies(
      db,
      deliveriesTable,
      deliveryPhotosTable,
      {
        listPrivateUploadObjects: async () => [],
        deleteObjectEntity: async (path) => {
          recoveryAttempts.push(path);
          return true;
        },
      },
      cleanupLogger,
    ),
  );
  assert.ok(recoverySummary);
  assert.equal(recoverySummary.resumedPhotoDeletions, 1);
  assert.deepEqual(recoveryAttempts, [objectPath]);

  const [remaining] = await db
    .select({ id: deliveryPhotosTable.id })
    .from(deliveryPhotosTable)
    .where(eq(deliveryPhotosTable.id, photo.id));
  assert.equal(remaining, undefined);
});

test("ручное удаление блокирует повторное прикрепление того же objectPath", async () => {
  actor = editor;
  const [sourceDelivery, targetDelivery] = await db
    .insert(deliveriesTable)
    .values([
      {
        siteId,
        driverUserId: assignedDriver.id,
        plannedDate: "2026-09-21",
        actualDate: "2026-09-21",
      },
      {
        siteId,
        driverUserId: assignedDriver.id,
        plannedDate: "2026-09-22",
        actualDate: "2026-09-22",
      },
    ])
    .returning({ id: deliveriesTable.id });
  const objectPath = `/objects/uploads/${randomUUID()}`;
  const [photo] = await db
    .insert(deliveryPhotosTable)
    .values({
      deliveryId: sourceDelivery.id,
      objectPath,
      fileName: "удаляемый-акт.pdf",
      mimeType: "application/pdf",
      uploadedBy: "Интеграционный тест",
    })
    .returning({ id: deliveryPhotosTable.id });

  const originalGetObjectEntityFile =
    ObjectStorageService.prototype.getObjectEntityFile;
  ObjectStorageService.prototype.getObjectEntityFile = async function (
    requestedPath,
  ) {
    assert.equal(requestedPath, objectPath);
    if (deletedObjectPaths.includes(requestedPath)) {
      throw new Error("object no longer exists");
    }
    return {
      getMetadata: async () => [{ contentType: "application/pdf" }],
    } as never;
  };

  let releaseDelete!: () => void;
  continueDelete = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  const deleteStarted = new Promise<void>((resolve) => {
    notifyDeleteStarted = resolve;
  });
  pausedDeletePath = objectPath;

  const deleteRequest = fetch(`${baseUrl}/delivery-photos/${photo.id}`, {
    method: "DELETE",
  });
  await deleteStarted;

  const attachRequest = fetch(
    `${baseUrl}/deliveries/${targetDelivery.id}/photos`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        objectPath,
        fileName: "повторно-прикреплённый-акт.pdf",
        mimeType: "application/pdf",
      }),
    },
  );
  const attachState = await Promise.race([
    attachRequest.then(() => "finished"),
    new Promise<"blocked">((resolve) =>
      setTimeout(() => resolve("blocked"), 100),
    ),
  ]);
  assert.equal(attachState, "blocked");

  releaseDelete();
  const [deleteResponse, attachResponse] = await Promise.all([
    deleteRequest,
    attachRequest,
  ]);
  ObjectStorageService.prototype.getObjectEntityFile =
    originalGetObjectEntityFile;
  pausedDeletePath = null;
  notifyDeleteStarted = null;
  continueDelete = null;

  assert.equal(deleteResponse.status, 204);
  assert.equal(attachResponse.status, 400);
  assert.equal(deletedObjectPaths.includes(objectPath), true);
  const brokenReferences = await db
    .select({ objectPath: deliveryPhotosTable.objectPath })
    .from(deliveryPhotosTable)
    .where(eq(deliveryPhotosTable.objectPath, objectPath));
  assert.deepEqual(brokenReferences, []);
});

test("удаление доставки очищает все связанные акты", async () => {
  actor = admin;
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2026-09-16",
      actualDate: "2026-09-16",
    })
    .returning({ id: deliveriesTable.id });
  const objectPaths = [
    `/objects/uploads/${randomUUID()}`,
    `/objects/uploads/${randomUUID()}`,
  ];
  await db.insert(deliveryPhotosTable).values(
    objectPaths.map((objectPath, index) => ({
      deliveryId: delivery.id,
      objectPath,
      fileName: `акт-${index + 1}.pdf`,
      mimeType: "application/pdf",
      uploadedBy: "Интеграционный тест",
    })),
  );

  const response = await fetch(`${baseUrl}/deliveries/${delivery.id}`, {
    method: "DELETE",
  });

  assert.equal(response.status, 204);
  assert.equal(
    objectPaths.every((path) => deletedObjectPaths.includes(path)),
    true,
  );
  const remainingPhotos = await db
    .select({ id: deliveryPhotosTable.id })
    .from(deliveryPhotosTable)
    .where(eq(deliveryPhotosTable.deliveryId, delivery.id));
  assert.deepEqual(remainingPhotos, []);
});

test("частичная ошибка удаления не оставляет ссылку на уже удалённый файл", async () => {
  actor = admin;
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2026-09-18",
      actualDate: "2026-09-18",
    })
    .returning({ id: deliveriesTable.id });
  const objectPaths = [
    `/objects/uploads/${randomUUID()}`,
    `/objects/uploads/${randomUUID()}`,
  ];
  await db.insert(deliveryPhotosTable).values(
    objectPaths.map((objectPath, index) => ({
      deliveryId: delivery.id,
      objectPath,
      fileName: `частичный-акт-${index + 1}.pdf`,
      mimeType: "application/pdf",
      uploadedBy: "Интеграционный тест",
    })),
  );

  successfulDeletesBeforeError = 1;
  const failedResponse = await fetch(`${baseUrl}/deliveries/${delivery.id}`, {
    method: "DELETE",
  });
  successfulDeletesBeforeError = null;

  assert.equal(failedResponse.status, 502);
  const remainingAfterFailure = await db
    .select({
      objectPath: deliveryPhotosTable.objectPath,
      deletionPendingAt: deliveryPhotosTable.deletionPendingAt,
    })
    .from(deliveryPhotosTable)
    .where(eq(deliveryPhotosTable.deliveryId, delivery.id));
  assert.equal(remainingAfterFailure.length, 2);
  assert.equal(
    remainingAfterFailure.every((photo) => photo.deletionPendingAt !== null),
    true,
  );
  const hiddenAfterFailure = await fetch(
    `${baseUrl}/deliveries/${delivery.id}/photos`,
  );
  assert.equal(hiddenAfterFailure.status, 200);
  assert.deepEqual(await hiddenAfterFailure.json(), []);

  const retryResponse = await fetch(`${baseUrl}/deliveries/${delivery.id}`, {
    method: "DELETE",
  });
  assert.equal(retryResponse.status, 204);
  const remainingAfterRetry = await db
    .select({ id: deliveryPhotosTable.id })
    .from(deliveryPhotosTable)
    .where(eq(deliveryPhotosTable.deliveryId, delivery.id));
  assert.deepEqual(remainingAfterRetry, []);
});

test("ожидающее удаление завершает доставку после сбоя Storage у первого запроса", async () => {
  actor = admin;
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2026-09-22",
      actualDate: "2026-09-22",
    })
    .returning({ id: deliveriesTable.id });
  const objectPath = `/objects/uploads/${randomUUID()}`;
  await db.insert(deliveryPhotosTable).values({
    deliveryId: delivery.id,
    objectPath,
    fileName: "акт-повторного-конкурентного-удаления.pdf",
    mimeType: "application/pdf",
    uploadedBy: "Интеграционный тест",
  });

  const attemptOffset = storageDeleteAttempts.length;
  let releaseDelete!: () => void;
  continueDelete = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  const deleteStarted = new Promise<void>((resolve) => {
    notifyDeleteStarted = resolve;
  });
  pausedDeletePath = objectPath;
  pausedDeleteError = new Error("storage unavailable");

  const firstDelete = fetch(`${baseUrl}/deliveries/${delivery.id}`, {
    method: "DELETE",
  });
  await deleteStarted;
  const secondDelete = fetch(`${baseUrl}/deliveries/${delivery.id}`, {
    method: "DELETE",
  });

  try {
    const secondState = await Promise.race([
      secondDelete.then(() => "finished"),
      new Promise<"blocked">((resolve) =>
        setTimeout(() => resolve("blocked"), 100),
      ),
    ]);
    assert.equal(secondState, "blocked");
  } finally {
    releaseDelete();
  }

  const responses = await Promise.race([
    Promise.all([firstDelete, secondDelete]),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Waiting deletion remained blocked")),
        5_000,
      ),
    ),
  ]);
  pausedDeletePath = null;
  pausedDeleteError = null;
  notifyDeleteStarted = null;
  continueDelete = null;

  assert.equal(responses[0].status, 502);
  assert.equal(responses[1].status, 204);
  assert.deepEqual(storageDeleteAttempts.slice(attemptOffset), [
    objectPath,
    objectPath,
  ]);
  assert.equal(
    storageDeleteResults.filter((result) => result.objectPath === objectPath)
      .length,
    1,
  );
  const [remainingDelivery, remainingPhotos] = await Promise.all([
    db
      .select({ id: deliveriesTable.id })
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, delivery.id)),
    db
      .select({ id: deliveryPhotosTable.id })
      .from(deliveryPhotosTable)
      .where(eq(deliveryPhotosTable.deliveryId, delivery.id)),
  ]);
  assert.deepEqual(remainingDelivery, []);
  assert.deepEqual(remainingPhotos, []);
});

test("два одновременных удаления доставки не удаляют акт повторно", async () => {
  actor = admin;
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2026-09-21",
      actualDate: "2026-09-21",
    })
    .returning({ id: deliveriesTable.id });
  const objectPath = `/objects/uploads/${randomUUID()}`;
  await db.insert(deliveryPhotosTable).values({
    deliveryId: delivery.id,
    objectPath,
    fileName: "акт-конкурентного-удаления.pdf",
    mimeType: "application/pdf",
    uploadedBy: "Интеграционный тест",
  });

  let releaseDelete!: () => void;
  continueDelete = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  const deleteStarted = new Promise<void>((resolve) => {
    notifyDeleteStarted = resolve;
  });
  pausedDeletePath = objectPath;
  const firstDelete = fetch(`${baseUrl}/deliveries/${delivery.id}`, {
    method: "DELETE",
  });
  await deleteStarted;

  const secondDelete = fetch(`${baseUrl}/deliveries/${delivery.id}`, {
    method: "DELETE",
  });
  try {
    const secondState = await Promise.race([
      secondDelete.then(() => "finished"),
      new Promise<"blocked">((resolve) =>
        setTimeout(() => resolve("blocked"), 100),
      ),
    ]);
    assert.equal(secondState, "blocked");
  } finally {
    releaseDelete();
  }

  const [firstResponse, secondResponse] = await Promise.all([
    firstDelete,
    secondDelete,
  ]);
  pausedDeletePath = null;
  notifyDeleteStarted = null;
  continueDelete = null;

  assert.equal(firstResponse.status, 204);
  assert.equal(secondResponse.status, 404);
  assert.deepEqual(await secondResponse.json(), {
    error: "Доставка не найдена",
  });
  assert.equal(
    storageDeleteResults.filter((result) => result.objectPath === objectPath)
      .length,
    1,
  );

  const [remainingDelivery, remainingPhotos] = await Promise.all([
    db
      .select({
        id: deliveriesTable.id,
        deletionPendingAt: deliveriesTable.deletionPendingAt,
      })
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, delivery.id)),
    db
      .select({
        id: deliveryPhotosTable.id,
        deletionPendingAt: deliveryPhotosTable.deletionPendingAt,
      })
      .from(deliveryPhotosTable)
      .where(eq(deliveryPhotosTable.deliveryId, delivery.id)),
  ]);
  assert.deepEqual(remainingDelivery, []);
  assert.deepEqual(remainingPhotos, []);
});

test("cleanup завершает удаление доставки после сбоя БД вслед за Storage", async () => {
  actor = admin;
  const deleteResultOffset = storageDeleteResults.length;
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2026-09-19",
      actualDate: "2026-09-19",
    })
    .returning({ id: deliveriesTable.id });
  const objectPaths = [
    `/objects/uploads/${randomUUID()}`,
    `/objects/uploads/${randomUUID()}`,
  ];
  await db.insert(deliveryPhotosTable).values([
    {
      deliveryId: delivery.id,
      objectPath: objectPaths[0],
      fileName: "test-parent-db-failure-after-storage-delete",
      mimeType: "application/pdf",
      uploadedBy: "Интеграционный тест",
    },
    {
      deliveryId: delivery.id,
      objectPath: objectPaths[1],
      fileName: "обычный-акт.pdf",
      mimeType: "application/pdf",
      uploadedBy: "Интеграционный тест",
    },
  ]);

  await db.execute(sql`
    create or replace function test_fail_parent_delivery_photo_delete()
    returns trigger
    language plpgsql
    as $$
    begin
      if old.file_name = 'test-parent-db-failure-after-storage-delete' then
        raise exception 'injected parent delivery delete failure';
      end if;
      return old;
    end;
    $$
  `);
  await db.execute(sql`
    create trigger test_fail_parent_delivery_photo_delete_trigger
    before delete on delivery_photos
    for each row execute function test_fail_parent_delivery_photo_delete()
  `);

  try {
    const failedResponse = await fetch(`${baseUrl}/deliveries/${delivery.id}`, {
      method: "DELETE",
    });
    assert.equal(failedResponse.status, 500);
    assert.equal(
      objectPaths.every((path) => deletedObjectPaths.includes(path)),
      true,
    );

    const [pendingDelivery] = await db
      .select({ deletionPendingAt: deliveriesTable.deletionPendingAt })
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, delivery.id));
    assert.ok(pendingDelivery?.deletionPendingAt);
    const pendingPhotos = await db
      .select({ deletionPendingAt: deliveryPhotosTable.deletionPendingAt })
      .from(deliveryPhotosTable)
      .where(eq(deliveryPhotosTable.deliveryId, delivery.id));
    assert.equal(pendingPhotos.length, 2);
    assert.equal(
      pendingPhotos.every((photo) => photo.deletionPendingAt !== null),
      true,
    );

    const hiddenResponse = await fetch(
      `${baseUrl}/deliveries/${delivery.id}/photos`,
    );
    assert.equal(hiddenResponse.status, 200);
    assert.deepEqual(await hiddenResponse.json(), []);
  } finally {
    await db.execute(
      sql`drop trigger if exists test_fail_parent_delivery_photo_delete_trigger on delivery_photos`,
    );
    await db.execute(
      sql`drop function if exists test_fail_parent_delivery_photo_delete()`,
    );
  }

  const cleanupDependenciesWithoutListedObjects =
    createProductionDeliveryUploadCleanupDependencies(
      db,
      deliveriesTable,
      deliveryPhotosTable,
      {
        listPrivateUploadObjects: async () => [],
        deleteObjectEntity: (path) =>
          new ObjectStorageService().deleteObjectEntity(path),
      },
      cleanupLogger,
    );
  const recoverySummary = await runLiveDeliveryUploadCleanup(
    cleanupDependenciesWithoutListedObjects,
  );
  assert.ok(recoverySummary);
  assert.equal(recoverySummary.resumedPhotoDeletions, 0);
  assert.equal(recoverySummary.resumedDeliveryDeletions, 1);
  assert.deepEqual(storageDeleteResults.slice(deleteResultOffset), [
    ...objectPaths
      .slice()
      .sort()
      .map((objectPath) => ({ objectPath, deleted: true })),
    ...objectPaths
      .slice()
      .sort()
      .map((objectPath) => ({ objectPath, deleted: false })),
  ]);
  const [remainingDelivery] = await db
    .select({ id: deliveriesTable.id })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, delivery.id));
  assert.equal(remainingDelivery, undefined);
  const remainingPhotos = await db
    .select({ id: deliveryPhotosTable.id })
    .from(deliveryPhotosTable)
    .where(eq(deliveryPhotosTable.deliveryId, delivery.id));
  assert.deepEqual(remainingPhotos, []);

  assert.ok(
    await runLiveDeliveryUploadCleanup(cleanupDependenciesWithoutListedObjects),
  );
});

test("cleanup завершает отложенный tombstone после восстановления Storage", async () => {
  const [failedDelivery, successfulDelivery] = await db
    .insert(deliveriesTable)
    .values([
      {
        siteId,
        driverUserId: assignedDriver.id,
        plannedDate: "2026-09-23",
        actualDate: "2026-09-23",
      },
      {
        siteId,
        driverUserId: assignedDriver.id,
        plannedDate: "2026-09-24",
        actualDate: "2026-09-24",
      },
    ])
    .returning({ id: deliveriesTable.id });
  const failedObjectPath = `/objects/uploads/a-fails-${randomUUID()}`;
  const successfulObjectPath = `/objects/uploads/z-works-${randomUUID()}`;
  const pendingAt = new Date();
  const [failedPhoto, successfulPhoto] = await db
    .insert(deliveryPhotosTable)
    .values([
      {
        deliveryId: failedDelivery.id,
        objectPath: failedObjectPath,
        fileName: "недоступный-tombstone.pdf",
        mimeType: "application/pdf",
        uploadedBy: "Интеграционный тест",
        deletionPendingAt: pendingAt,
      },
      {
        deliveryId: successfulDelivery.id,
        objectPath: successfulObjectPath,
        fileName: "доступный-tombstone.pdf",
        mimeType: "application/pdf",
        uploadedBy: "Интеграционный тест",
        deletionPendingAt: pendingAt,
      },
    ])
    .returning({ id: deliveryPhotosTable.id });
  const attemptedPaths: string[] = [];
  const storedPaths = new Set([failedObjectPath, successfulObjectPath]);

  try {
    const summary = await runLiveDeliveryUploadCleanup(
      createProductionDeliveryUploadCleanupDependencies(
        db,
        deliveriesTable,
        deliveryPhotosTable,
        {
          listPrivateUploadObjects: async () => [],
          deleteObjectEntity: async (objectPath) => {
            attemptedPaths.push(objectPath);
            if (objectPath === failedObjectPath) {
              throw new Error("injected storage outage");
            }
            storedPaths.delete(objectPath);
            return true;
          },
        },
        cleanupLogger,
      ),
    );

    assert.ok(summary);
    assert.equal(summary.scanned, 2);
    assert.equal(summary.candidates, 2);
    assert.equal(summary.deleted, 1);
    assert.equal(summary.resumedPhotoDeletions, 1);
    assert.equal(summary.resumedDeliveryDeletions, 0);
    assert.equal(summary.failed, 1);
    assert.deepEqual(summary.failures, [
      {
        objectPath: failedObjectPath,
        error: "injected storage outage",
      },
    ]);
    assert.deepEqual(attemptedPaths, [failedObjectPath, successfulObjectPath]);

    const remainingPhotos = await db
      .select({
        id: deliveryPhotosTable.id,
        deletionPendingAt: deliveryPhotosTable.deletionPendingAt,
      })
      .from(deliveryPhotosTable)
      .where(
        inArray(deliveryPhotosTable.id, [failedPhoto.id, successfulPhoto.id]),
      );
    assert.deepEqual(remainingPhotos, [
      {
        id: failedPhoto.id,
        deletionPendingAt: pendingAt,
      },
    ]);
    assert.deepEqual([...storedPaths], [failedObjectPath]);

    const recoveredSummary = await runLiveDeliveryUploadCleanup(
      createProductionDeliveryUploadCleanupDependencies(
        db,
        deliveriesTable,
        deliveryPhotosTable,
        {
          listPrivateUploadObjects: async () => [],
          deleteObjectEntity: async (objectPath) => {
            attemptedPaths.push(objectPath);
            storedPaths.delete(objectPath);
            return true;
          },
        },
        cleanupLogger,
      ),
    );

    assert.ok(recoveredSummary);
    assert.equal(recoveredSummary.scanned, 1);
    assert.equal(recoveredSummary.candidates, 1);
    assert.equal(recoveredSummary.deleted, 1);
    assert.equal(recoveredSummary.resumedPhotoDeletions, 1);
    assert.equal(recoveredSummary.resumedDeliveryDeletions, 0);
    assert.equal(recoveredSummary.failed, 0);
    assert.deepEqual(recoveredSummary.failures, []);
    assert.deepEqual(attemptedPaths, [
      failedObjectPath,
      successfulObjectPath,
      failedObjectPath,
    ]);
    assert.deepEqual([...storedPaths], []);

    const finalizedPhotos = await db
      .select({ id: deliveryPhotosTable.id })
      .from(deliveryPhotosTable)
      .where(
        inArray(deliveryPhotosTable.id, [failedPhoto.id, successfulPhoto.id]),
      );
    assert.deepEqual(finalizedPhotos, []);
  } finally {
    await db
      .delete(deliveriesTable)
      .where(
        inArray(deliveriesTable.id, [failedDelivery.id, successfulDelivery.id]),
      );
  }
});

test("cleanup после таймаута Storage продолжает другие tombstones без поздней DB-финализации", async () => {
  const [stalledDelivery, successfulDelivery] = await db
    .insert(deliveriesTable)
    .values([
      {
        siteId,
        driverUserId: assignedDriver.id,
        plannedDate: "2026-09-25",
        actualDate: "2026-09-25",
      },
      {
        siteId,
        driverUserId: assignedDriver.id,
        plannedDate: "2026-09-26",
        actualDate: "2026-09-26",
      },
    ])
    .returning({ id: deliveriesTable.id });
  const stalledObjectPath = `/objects/uploads/a-stalled-${randomUUID()}`;
  const successfulObjectPath = `/objects/uploads/z-successful-${randomUUID()}`;
  const pendingAt = new Date();
  const [stalledPhoto, successfulPhoto] = await db
    .insert(deliveryPhotosTable)
    .values([
      {
        deliveryId: stalledDelivery.id,
        objectPath: stalledObjectPath,
        fileName: "зависший-tombstone.pdf",
        mimeType: "application/pdf",
        uploadedBy: "Интеграционный тест",
        deletionPendingAt: pendingAt,
      },
      {
        deliveryId: successfulDelivery.id,
        objectPath: successfulObjectPath,
        fileName: "успешный-tombstone.pdf",
        mimeType: "application/pdf",
        uploadedBy: "Интеграционный тест",
        deletionPendingAt: pendingAt,
      },
    ])
    .returning({ id: deliveryPhotosTable.id });
  let resolveStalledDelete: (() => void) | undefined;
  const stalledDelete = new Promise<void>((resolve) => {
    resolveStalledDelete = resolve;
  });
  const attemptedPaths: string[] = [];

  try {
    const summary = await runLiveDeliveryUploadCleanup(
      createProductionDeliveryUploadCleanupDependencies(
        db,
        deliveriesTable,
        deliveryPhotosTable,
        {
          listPrivateUploadObjects: async () => [],
          deleteObjectEntity: async (objectPath) => {
            attemptedPaths.push(objectPath);
            if (objectPath === stalledObjectPath) await stalledDelete;
            return true;
          },
        },
        cleanupLogger,
        10,
      ),
    );

    assert.ok(summary);
    assert.equal(summary.deleted, 1);
    assert.equal(summary.resumedPhotoDeletions, 1);
    assert.equal(summary.failed, 1);
    assert.deepEqual(attemptedPaths, [stalledObjectPath, successfulObjectPath]);
    assert.match(summary.failures[0]?.error ?? "", /timed out after 10ms/);

    let remainingPhotos = await db
      .select({ id: deliveryPhotosTable.id })
      .from(deliveryPhotosTable)
      .where(
        inArray(deliveryPhotosTable.id, [stalledPhoto.id, successfulPhoto.id]),
      );
    assert.deepEqual(remainingPhotos, [{ id: stalledPhoto.id }]);

    resolveStalledDelete!();
    await new Promise((resolve) => setImmediate(resolve));

    remainingPhotos = await db
      .select({ id: deliveryPhotosTable.id })
      .from(deliveryPhotosTable)
      .where(
        inArray(deliveryPhotosTable.id, [stalledPhoto.id, successfulPhoto.id]),
      );
    assert.deepEqual(remainingPhotos, [{ id: stalledPhoto.id }]);
  } finally {
    resolveStalledDelete?.();
    await db
      .delete(deliveriesTable)
      .where(
        inArray(deliveriesTable.id, [
          stalledDelivery.id,
          successfulDelivery.id,
        ]),
      );
  }
});

test("прикрепление не может проскочить во время удаления доставки", async () => {
  actor = admin;
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2026-09-17",
      actualDate: "2026-09-17",
    })
    .returning({ id: deliveriesTable.id });
  const existingObjectPath = `/objects/uploads/${randomUUID()}`;
  const concurrentObjectPath = `/objects/uploads/${randomUUID()}`;
  await db.insert(deliveryPhotosTable).values({
    deliveryId: delivery.id,
    objectPath: existingObjectPath,
    fileName: "исходный-акт.pdf",
    mimeType: "application/pdf",
    uploadedBy: "Интеграционный тест",
  });

  let releaseDelete!: () => void;
  continueDelete = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  const deleteStarted = new Promise<void>((resolve) => {
    notifyDeleteStarted = resolve;
  });
  pausedDeletePath = existingObjectPath;

  const deleteRequest = fetch(`${baseUrl}/deliveries/${delivery.id}`, {
    method: "DELETE",
  });
  await deleteStarted;

  const attachRequest = fetch(`${baseUrl}/deliveries/${delivery.id}/photos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      objectPath: concurrentObjectPath,
      fileName: "конкурентный-акт.pdf",
      mimeType: "application/pdf",
    }),
  });
  const stateWhileDeleting = await Promise.race([
    attachRequest.then(() => "finished"),
    new Promise<"blocked">((resolve) =>
      setTimeout(() => resolve("blocked"), 100),
    ),
  ]);
  assert.equal(stateWhileDeleting, "blocked");

  releaseDelete();
  const [deleteResponse, attachResponse] = await Promise.all([
    deleteRequest,
    attachRequest,
  ]);
  pausedDeletePath = null;
  notifyDeleteStarted = null;
  continueDelete = null;

  assert.equal(deleteResponse.status, 204);
  assert.equal(attachResponse.status, 404);
  assert.equal(deletedObjectPaths.includes(existingObjectPath), true);
  assert.equal(deletedObjectPaths.includes(concurrentObjectPath), false);
  const remainingPhotos = await db
    .select({ id: deliveryPhotosTable.id })
    .from(deliveryPhotosTable)
    .where(eq(deliveryPhotosTable.deliveryId, delivery.id));
  assert.deepEqual(remainingPhotos, []);
});

test("cleanup ждёт удаление доставки и не удаляет тот же объект параллельно", async () => {
  actor = admin;
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2026-09-20",
      actualDate: "2026-09-20",
    })
    .returning({ id: deliveriesTable.id });
  const objectPath = `/objects/uploads/${randomUUID()}`;
  await db.insert(deliveryPhotosTable).values({
    deliveryId: delivery.id,
    objectPath,
    fileName: "конкурентная-уборка.pdf",
    mimeType: "application/pdf",
    uploadedBy: "Интеграционный тест",
  });

  let releaseDelete!: () => void;
  continueDelete = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  const deleteStarted = new Promise<void>((resolve) => {
    notifyDeleteStarted = resolve;
  });
  pausedDeletePath = objectPath;

  const deleteRequest = fetch(`${baseUrl}/deliveries/${delivery.id}`, {
    method: "DELETE",
  });
  await deleteStarted;

  const cleanupRun = runLiveDeliveryUploadCleanup(
    createProductionDeliveryUploadCleanupDependencies(
      db,
      deliveriesTable,
      deliveryPhotosTable,
      {
        listPrivateUploadObjects: async () =>
          deletedObjectPaths.includes(objectPath)
            ? []
            : [
                {
                  objectPath,
                  createdAt: new Date("2020-01-01T00:00:00.000Z"),
                },
              ],
        deleteObjectEntity: (path) =>
          new ObjectStorageService().deleteObjectEntity(path),
      },
      cleanupLogger,
    ),
    { minimumAgeHours: 1 },
  );
  const cleanupState = await Promise.race([
    cleanupRun.then(() => "finished"),
    new Promise<"blocked">((resolve) =>
      setTimeout(() => resolve("blocked"), 100),
    ),
  ]);
  assert.equal(cleanupState, "blocked");

  releaseDelete();
  const [deleteResponse, cleanupSummary] = await Promise.all([
    deleteRequest,
    cleanupRun,
  ]);
  pausedDeletePath = null;
  notifyDeleteStarted = null;
  continueDelete = null;

  assert.equal(deleteResponse.status, 204);
  assert.ok(cleanupSummary);
  assert.equal(
    storageDeleteResults.filter((result) => result.objectPath === objectPath)
      .length,
    1,
  );
  const [remainingDelivery] = await db
    .select({ id: deliveriesTable.id })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, delivery.id));
  assert.equal(remainingDelivery, undefined);
});

test("второй экземпляр API пропускает уборку, пока первый удерживает global lock", async () => {
  const objectPath = `/objects/uploads/${randomUUID()}`;
  let releaseDelete!: () => void;
  continueDelete = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  const deleteStarted = new Promise<void>((resolve) => {
    notifyDeleteStarted = resolve;
  });
  pausedDeletePath = objectPath;
  const dependencies = cleanupDependencies(objectPath);

  const firstRun = runLiveDeliveryUploadCleanup(dependencies, {
    minimumAgeHours: 1,
  });
  await deleteStarted;

  let releaseBeforeFailure = true;
  try {
    const secondRun = await Promise.race([
      runLiveDeliveryUploadCleanup(dependencies, {
        minimumAgeHours: 1,
      }),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 1_000),
      ),
    ]);
    assert.notEqual(secondRun, "timeout");
    assert.equal(secondRun, null);
    releaseBeforeFailure = false;
  } finally {
    releaseDelete();
  }

  const firstSummary = await firstRun;
  pausedDeletePath = null;
  notifyDeleteStarted = null;
  continueDelete = null;

  assert.equal(releaseBeforeFailure, false);
  assert.equal(firstSummary?.deleted, 1);
  assert.equal(deletedObjectPaths.includes(objectPath), true);
});

test("cleanup ждёт path lock и не удаляет одновременно прикреплённый акт", async () => {
  actor = editor;
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2026-09-16",
      actualDate: "2026-09-16",
    })
    .returning({ id: deliveriesTable.id });
  const objectPath = `/objects/uploads/${randomUUID()}`;
  const originalGetObjectEntityFile =
    ObjectStorageService.prototype.getObjectEntityFile;
  let releaseMetadata!: () => void;
  const continueMetadata = new Promise<void>((resolve) => {
    releaseMetadata = resolve;
  });
  let notifyMetadataStarted!: () => void;
  const metadataStarted = new Promise<void>((resolve) => {
    notifyMetadataStarted = resolve;
  });
  ObjectStorageService.prototype.getObjectEntityFile = async function (
    requestedPath,
  ) {
    assert.equal(requestedPath, objectPath);
    return {
      getMetadata: async () => {
        notifyMetadataStarted();
        await continueMetadata;
        return [{ contentType: "application/pdf" }];
      },
    } as never;
  };

  const attachRequest = fetch(`${baseUrl}/deliveries/${delivery.id}/photos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      objectPath,
      fileName: "конкурентный-акт.pdf",
      mimeType: "application/pdf",
    }),
  });
  await metadataStarted;

  const cleanupRun = runLiveDeliveryUploadCleanup(
    cleanupDependencies(objectPath),
    { minimumAgeHours: 1 },
  );
  const cleanupState = await Promise.race([
    cleanupRun.then(() => "finished"),
    new Promise<"blocked">((resolve) =>
      setTimeout(() => resolve("blocked"), 100),
    ),
  ]);
  assert.equal(cleanupState, "blocked");

  releaseMetadata();
  const [attachResponse, cleanupSummary] = await Promise.all([
    attachRequest,
    cleanupRun,
  ]);
  ObjectStorageService.prototype.getObjectEntityFile =
    originalGetObjectEntityFile;

  assert.equal(attachResponse.status, 201);
  assert.equal(cleanupSummary?.deleted, 0);
  assert.equal(cleanupSummary?.raceSkipped, 1);
  assert.equal(deletedObjectPaths.includes(objectPath), false);
  const attachedPhotos = await db
    .select({ objectPath: deliveryPhotosTable.objectPath })
    .from(deliveryPhotosTable)
    .where(eq(deliveryPhotosTable.objectPath, objectPath));
  assert.deepEqual(attachedPhotos, [{ objectPath }]);
});

test("прикрепление ждёт path lock и не ссылается на удалённый cleanup объект", async () => {
  actor = editor;
  const [delivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId,
      driverUserId: assignedDriver.id,
      plannedDate: "2026-09-14",
      actualDate: "2026-09-14",
    })
    .returning({ id: deliveriesTable.id });
  const objectPath = `/objects/uploads/${randomUUID()}`;
  const originalGetObjectEntityFile =
    ObjectStorageService.prototype.getObjectEntityFile;
  ObjectStorageService.prototype.getObjectEntityFile = async function (
    requestedPath,
  ) {
    assert.equal(requestedPath, objectPath);
    if (deletedObjectPaths.includes(requestedPath)) {
      throw new Error("object no longer exists");
    }
    return {
      getMetadata: async () => [{ contentType: "application/pdf" }],
    } as never;
  };
  let releaseDelete!: () => void;
  continueDelete = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  const deleteStarted = new Promise<void>((resolve) => {
    notifyDeleteStarted = resolve;
  });
  pausedDeletePath = objectPath;

  const cleanupRun = runLiveDeliveryUploadCleanup(
    cleanupDependencies(objectPath),
    { minimumAgeHours: 1 },
  );
  await deleteStarted;

  const attachRequest = fetch(`${baseUrl}/deliveries/${delivery.id}/photos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      objectPath,
      fileName: "уже-удалённый-акт.pdf",
      mimeType: "application/pdf",
    }),
  });
  const attachState = await Promise.race([
    attachRequest.then(() => "finished"),
    new Promise<"blocked">((resolve) =>
      setTimeout(() => resolve("blocked"), 100),
    ),
  ]);
  assert.equal(attachState, "blocked");

  releaseDelete();
  const [cleanupSummary, attachResponse] = await Promise.all([
    cleanupRun,
    attachRequest,
  ]);
  ObjectStorageService.prototype.getObjectEntityFile =
    originalGetObjectEntityFile;
  pausedDeletePath = null;
  notifyDeleteStarted = null;
  continueDelete = null;

  assert.equal(cleanupSummary?.deleted, 1);
  assert.equal(attachResponse.status, 400);
  assert.match(
    String(((await attachResponse.json()) as { error?: string }).error),
    /не найден/,
  );
  assert.equal(deletedObjectPaths.includes(objectPath), true);
  const brokenReferences = await db
    .select({ objectPath: deliveryPhotosTable.objectPath })
    .from(deliveryPhotosTable)
    .where(eq(deliveryPhotosTable.objectPath, objectPath));
  assert.deepEqual(brokenReferences, []);
});
