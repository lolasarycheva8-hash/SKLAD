import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";

import {
  db,
  deliveriesTable,
  deliveryPhotosTable,
  deliveryUploadCleanupStatusTable,
  pool,
  sitesTable,
  appUsersTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import express from "express";

import deliveriesRouter from "../routes/deliveries.ts";
import lookupsRouter from "../routes/lookups.ts";
import myRouter from "../routes/my.ts";
import ordersRouter from "../routes/orders.ts";
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
app.use((req, _res, next) => {
  req.appUser = actor;
  req.log = {
    error() {},
    info() {},
  } as unknown as typeof req.log;
  next();
});
app.use(deliveriesRouter);
app.use(lookupsRouter);
app.use(myRouter);
app.use(ordersRouter);
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
let storageDeleteError: Error | null = null;
let successfulDeletesBeforeError: number | null = null;
let pausedDeletePath: string | null = null;
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
  if (storageDeleteError) {
    throw storageDeleteError;
  }
  if (successfulDeletesBeforeError === 0) {
    throw new Error("storage unavailable after partial cleanup");
  }
  if (objectPath === pausedDeletePath && continueDelete) {
    notifyDeleteStarted?.();
    await continueDelete;
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

const editor = testUser("logistician", { editableSections: ["deliveries"] });
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

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  const [site] = await db
    .insert(sitesTable)
    .values({
      name: `Тест актов ${randomUUID()}`,
      address: "Тестовый адрес",
      branch: "Тестовый куст",
      client: "Тестовый клиент",
      manager: "Тестовый менеджер",
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
          client: "Тестовый клиент",
          manager: "Тестовый менеджер",
          director: "Тестовый руководитель",
          project: "Тестовый проект",
          legacyDriver: ` \v\t${legacyName}\u00a0 `,
        },
        {
          name: `Подтверждённый legacy объект ${randomUUID()}`,
          address: "Тестовый адрес",
          branch: "Тестовый куст",
          client: "Тестовый клиент",
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
    const forbidden = await fetch(
      `${baseUrl}/admin/legacy-driver-assignments`,
    );
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
      String(
        ((await conflictingDuplicate.json()) as { error?: string }).error,
      ),
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

    const resolved = await fetch(
      `${baseUrl}/admin/legacy-driver-assignments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mappings: [{ legacyName, driverUserId: assignedDriver.id }],
        }),
      },
    );
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

    const repeated = await fetch(
      `${baseUrl}/admin/legacy-driver-assignments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mappings: [{ legacyName, driverUserId: assignedDriver.id }],
        }),
      },
    );
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
          client: "Тестовый клиент",
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
    }>;
    const fixtureItems = initialItems.filter((item) =>
      legacyNames.includes(item.legacyName),
    );
    assert.equal(fixtureItems.length, 2);
    assert.equal(fixtureItems[0].similarityReviewed, false);
    assert.equal(fixtureItems[0].similarityReviewedAt, null);
    assert.equal(fixtureItems[0].similarityReviewedByName, null);
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

    const listed = await fetch(
      `${baseUrl}/admin/legacy-driver-assignments`,
    );
    assert.equal(listed.status, 200);
    const listedItems = (await listed.json()) as Array<{
      legacyName: string;
      similarityReviewed: boolean;
      similarityReviewedAt: string | null;
      similarityReviewedByName: string | null;
    }>;
    const reviewedItems = listedItems.filter((item) =>
      legacyNames.includes(item.legacyName),
    );
    assert.deepEqual(
      reviewedItems.map((item) => item.similarityReviewed),
      [true, true],
    );
    assert.deepEqual(
      reviewedItems.map((item) => item.similarityReviewedByName),
      [reviewer.name, reviewer.name],
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

    await db.delete(appUsersTable).where(eq(appUsersTable.id, reviewer.id));
    actor = admin;
    const afterReviewerDeletion = await fetch(
      `${baseUrl}/admin/legacy-driver-assignments`,
    );
    assert.equal(afterReviewerDeletion.status, 200);
    const afterReviewerDeletionItems =
      (await afterReviewerDeletion.json()) as Array<{
        legacyName: string;
        similarityReviewed: boolean;
        similarityReviewedAt: string | null;
        similarityReviewedByName: string | null;
      }>;
    const historicalItems = afterReviewerDeletionItems.filter((item) =>
      legacyNames.includes(item.legacyName),
    );
    assert.deepEqual(
      historicalItems.map((item) => item.similarityReviewed),
      [true, true],
    );
    assert.deepEqual(
      historicalItems.map((item) => item.similarityReviewedByName),
      [null, null],
    );
    assert.deepEqual(
      historicalItems.map((item) => item.similarityReviewedAt),
      [reviewedAt, reviewedAt],
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
    }>;
    assert.deepEqual(
      unreviewedItems
        .filter((item) => legacyNames.includes(item.legacyName))
        .map((item) => ({
          reviewed: item.similarityReviewed,
          reviewedAt: item.similarityReviewedAt,
          reviewedByName: item.similarityReviewedByName,
        })),
      legacyNames.map(() => ({
        reviewed: false,
        reviewedAt: null,
        reviewedByName: null,
      })),
    );
  } finally {
    if (createdSiteIds.length > 0) {
      await db
        .delete(sitesTable)
        .where(inArray(sitesTable.id, createdSiteIds));
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
        client: "Тестовый клиент",
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
      [assignedDriver.id, otherDriver.id].includes(
        siteRow.driverUserId ?? "",
      ),
      true,
    );
  } finally {
    if (createdSiteId) {
      await db.delete(sitesTable).where(eq(sitesTable.id, createdSiteId));
    }
  }
});

test("массовая загрузка графика требует водителя-пользователя в каждой строке", async () => {
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

  assert.equal(response.status, 400);
  assert.match(
    String(((await response.json()) as { error?: string }).error),
    /водитель из справочника пользователей/,
  );
});

test("доставка без даты создаётся, попадает в месяц, но исключается фильтром дат", async () => {
  actor = editor;
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
  actor = editor;

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
  actor = editor;
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

test("только назначенный активный водитель изменяет общий комментарий", async () => {
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
  actor = manager;

  const fullSites = await fetch(`${baseUrl}/sites`);
  assert.equal(fullSites.status, 403);
  const fullSitesMixedCase = await fetch(`${baseUrl}/SITES`);
  assert.equal(fullSitesMixedCase.status, 403);

  const deliverySites = await fetch(`${baseUrl}/deliveries/site-lookup`);
  assert.equal(deliverySites.status, 200);
  const deliverySiteRows = (await deliverySites.json()) as Array<
    Record<string, unknown>
  >;
  const ownSite = deliverySiteRows.find((row) => row.id === siteId);
  assert.ok(ownSite);
  assert.deepEqual(Object.keys(ownSite).sort(), [
    "address",
    "branch",
    "client",
    "deliveryType",
    "driver",
    "driverUserId",
    "id",
    "isClosed",
    "manager",
    "name",
  ]);

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
      assert.equal(
        (postgresError as Error & { code?: string }).code,
        "P0001",
      );
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
    assert.equal(listed.some((item) => item.id === photo.id), false);
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
  assert.equal(listed.some((item) => item.id === photo.id), false);

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
  assert.deepEqual(await secondResponse.json(), { error: "Delivery not found" });
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
  assert.deepEqual(
    storageDeleteResults.slice(deleteResultOffset),
    [
      ...objectPaths
        .slice()
        .sort()
        .map((objectPath) => ({ objectPath, deleted: true })),
      ...objectPaths
        .slice()
        .sort()
        .map((objectPath) => ({ objectPath, deleted: false })),
    ],
  );
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
    await runLiveDeliveryUploadCleanup(
      cleanupDependenciesWithoutListedObjects,
    ),
  );
});

test("сбой Storage одного tombstone не задерживает независимую финализацию", async () => {
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
      .where(inArray(deliveryPhotosTable.id, [failedPhoto.id, successfulPhoto.id]));
    assert.deepEqual(remainingPhotos, [
      {
        id: failedPhoto.id,
        deletionPendingAt: pendingAt,
      },
    ]);
  } finally {
    await db
      .delete(deliveriesTable)
      .where(inArray(deliveriesTable.id, [
        failedDelivery.id,
        successfulDelivery.id,
      ]));
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
