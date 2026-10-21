import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { eq } from "drizzle-orm";
import {
  appUsersTable,
  clientsTable,
  db,
  deliveriesTable,
  deliveryPhotosTable,
  deliveryTypesTable,
  siteChangeRequestsTable,
  sitesTable,
  tradeNamesTable,
} from "@workspace/db";
import type { AuthenticatedAppUser } from "./user-roles.ts";
import sitesRouter from "../routes/sites.ts";

let actor: AuthenticatedAppUser;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.appUser = actor;
  req.log = { info() {}, warn() {}, error() {} } as unknown as typeof req.log;
  next();
});
app.use(sitesRouter);
const server = app.listen(0);

let baseUrl = "";
let siteId = "";
let clientId = "";
let clientName = "";
let alternateClientId = "";
let alternateClientName = "";
let driverUserId = "";
let tradeName = "";
let deliveryType = "";
const createdSiteIds: string[] = [];
const createdDeliveryIds: string[] = [];
const createdDeliveryPhotoIds: string[] = [];
let admin: AuthenticatedAppUser;
let logistician: AuthenticatedAppUser;
const closureAuthorIds: string[] = [];

function asAuthenticated(
  row: typeof appUsersTable.$inferSelect,
): AuthenticatedAppUser {
  return {
    ...row,
    role:
      row.role === "viewer"
        ? "manager"
        : row.role === "editor"
          ? "logistician"
          : row.role,
  };
}

async function request(
  path: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

before(async () => {
  await new Promise<void>((resolve) => {
    if (server.listening) resolve();
    else server.once("listening", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [adminRow, logisticianRow, driverRow] = await db
    .insert(appUsersTable)
    .values([
      {
        clerkUserId: `site-change-admin-${randomUUID()}`,
        email: `admin-${randomUUID()}@example.test`,
        name: "Администратор теста",
        role: "admin",
        editableSections: [],
      },
      {
        clerkUserId: `site-change-logistician-${randomUUID()}`,
        email: `logistician-${randomUUID()}@example.test`,
        name: "Логист теста",
        role: "logistician",
        editableSections: ["sites"],
      },
      {
        clerkUserId: `site-change-driver-${randomUUID()}`,
        email: `driver-${randomUUID()}@example.test`,
        name: "Водитель теста",
        role: "driver",
        editableSections: [],
        isDriver: true,
      },
    ])
    .returning();
  admin = asAuthenticated(adminRow);
  logistician = asAuthenticated(logisticianRow);
  driverUserId = driverRow.id;
  actor = admin;
  const [client, alternateClient] = await db
    .insert(clientsTable)
    .values([
      { name: `Клиент ${randomUUID()}` },
      { name: `Другой клиент ${randomUUID()}` },
    ])
    .returning();
  clientId = client.id;
  clientName = client.name;
  alternateClientId = alternateClient.id;
  alternateClientName = alternateClient.name;
  tradeName = `Торговое название ${randomUUID()}`;
  deliveryType = `Тип поставки ${randomUUID()}`;
  await db.insert(tradeNamesTable).values({ name: tradeName });
  await db.insert(deliveryTypesTable).values({ name: deliveryType });
  const [site] = await db
    .insert(sitesTable)
    .values({
      name: `Объект ${randomUUID()}`,
      address: "Исходный адрес",
      branch: "Исходный куст",
      client: client.name,
      clientId,
      manager: "Исходный менеджер",
      director: "Руководитель",
      project: "Проект",
    })
    .returning();
  siteId = site.id;
});

after(async () => {
  if (logistician) {
    await db
      .delete(siteChangeRequestsTable)
      .where(eq(siteChangeRequestsTable.authorUserId, logistician.id));
  }
  for (const authorId of closureAuthorIds) {
    await db
      .delete(siteChangeRequestsTable)
      .where(eq(siteChangeRequestsTable.authorUserId, authorId));
  }
  for (const id of createdDeliveryPhotoIds) {
    await db.delete(deliveryPhotosTable).where(eq(deliveryPhotosTable.id, id));
  }
  for (const id of createdDeliveryIds) {
    await db.delete(deliveriesTable).where(eq(deliveriesTable.id, id));
  }
  for (const id of createdSiteIds) {
    await db.delete(sitesTable).where(eq(sitesTable.id, id));
  }
  if (siteId) await db.delete(sitesTable).where(eq(sitesTable.id, siteId));
  if (tradeName) {
    await db.delete(tradeNamesTable).where(eq(tradeNamesTable.name, tradeName));
  }
  if (deliveryType) {
    await db
      .delete(deliveryTypesTable)
      .where(eq(deliveryTypesTable.name, deliveryType));
  }
  if (alternateClientId) {
    await db.delete(clientsTable).where(eq(clientsTable.id, alternateClientId));
  }
  if (clientId)
    await db.delete(clientsTable).where(eq(clientsTable.id, clientId));
  if (admin && logistician) {
    await db.delete(appUsersTable).where(eq(appUsersTable.id, admin.id));
    await db.delete(appUsersTable).where(eq(appUsersTable.id, logistician.id));
  }
  for (const authorId of closureAuthorIds) {
    await db.delete(appUsersTable).where(eq(appUsersTable.id, authorId));
  }
  if (driverUserId) {
    await db.delete(appUsersTable).where(eq(appUsersTable.id, driverUserId));
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("логист с правом на объекты напрямую изменяет все редактируемые поля", async () => {
  actor = logistician;
  const directName = `Объект после правки ${randomUUID()}`;
  const directBody = {
    name: directName,
    address: "Новый адрес",
    branch: "Новый куст",
    customer: `  ${tradeName}  `,
    clientId: alternateClientId,
    manager: "Новый менеджер",
    managerContact: "Новый контакт",
    director: "Новый руководитель",
    project: "Новый проект",
    driverUserId,
    deliveryType: `  ${deliveryType}  `,
    features: "  Новые особенности  ",
  };
  const directResponse = await request(`/sites/${siteId}`, "PATCH", directBody);
  assert.equal(directResponse.status, 200);
  const direct = (await directResponse.json()) as Record<string, unknown>;
  const modeResponse = await request(`/sites/${siteId}`, "PATCH", {
    clientId: alternateClientId,
    serviceMode: "additional_only",
  });
  assert.equal(modeResponse.status, 200);
  const modeSite = await modeResponse.json() as Record<string, unknown>;
  assert.equal(modeSite.serviceMode, "additional_only");
  assert.equal(modeSite.deliveryType, deliveryType, "формат обслуживания не меняет исторический тип");
  const [persistedMode] = await db.select().from(sitesTable).where(eq(sitesTable.id, siteId));
  assert.equal(persistedMode.serviceMode, "additional_only");
  assert.deepEqual(
    {
      name: direct.name,
      address: direct.address,
      branch: direct.branch,
      customer: direct.customer,
      client: direct.client,
      clientId: direct.clientId,
      manager: direct.manager,
      managerContact: direct.managerContact,
      director: direct.director,
      project: direct.project,
      driverUserId: direct.driverUserId,
      deliveryType: direct.deliveryType,
      features: direct.features,
    },
    {
      name: directName,
      address: "Новый адрес",
      branch: "Новый куст",
      customer: tradeName,
      client: alternateClientName,
      clientId: alternateClientId,
      manager: "Новый менеджер",
      managerContact: "Новый контакт",
      director: "Новый руководитель",
      project: "Новый проект",
      driverUserId,
      deliveryType,
      features: "Новые особенности",
    },
  );
  const [persistedDirect] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.id, siteId));
  assert.deepEqual(
    {
      name: persistedDirect.name,
      address: persistedDirect.address,
      branch: persistedDirect.branch,
      customer: persistedDirect.customer,
      client: persistedDirect.client,
      clientId: persistedDirect.clientId,
      manager: persistedDirect.manager,
      managerContact: persistedDirect.managerContact,
      director: persistedDirect.director,
      project: persistedDirect.project,
      driverUserId: persistedDirect.driverUserId,
      deliveryType: persistedDirect.deliveryType,
      features: persistedDirect.features,
    },
    {
      name: directName,
      address: "Новый адрес",
      branch: "Новый куст",
      customer: tradeName,
      client: alternateClientName,
      clientId: alternateClientId,
      manager: "Новый менеджер",
      managerContact: "Новый контакт",
      director: "Новый руководитель",
      project: "Новый проект",
      driverUserId,
      deliveryType,
      features: "Новые особенности",
    },
  );

  assert.equal(
    (await request(`/sites/${siteId}`, "PATCH", { branch: "Без клиента" }))
      .status,
    400,
  );
  assert.equal(
    (
      await request(`/sites/${siteId}`, "PATCH", {
        clientId: "не-uuid",
        branch: "Невалидное значение",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/sites/${siteId}`, "PATCH", {
        clientId: alternateClientId,
        deliveryType: `Несуществующий тип ${randomUUID()}`,
      })
    ).status,
    400,
  );

  for (const deniedActor of [
    { ...logistician, editableSections: [] },
    { ...logistician, role: "manager" as const, editableSections: [] },
    { ...logistician, role: "driver" as const },
  ]) {
    actor = deniedActor;
    assert.equal(
      (
        await request(`/sites/${siteId}`, "PATCH", {
          clientId: alternateClientId,
          branch: "Запрещённая правка",
        })
      ).status,
      403,
    );
  }
  assert.equal(
    (await db.select().from(sitesTable).where(eq(sitesTable.id, siteId)))[0]
      .branch,
    "Новый куст",
  );

  actor = logistician;
  assert.equal(
    (
      await request(`/sites/${siteId}/features`, "PATCH", {
        features: "Новые особенности",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/sites/${siteId}/change-requests`, "POST", {
        features: "Особенности нельзя согласовывать",
      })
    ).status,
    400,
  );
  const createdSiteResponse = await request("/sites", "POST", {
    name: `Объект логиста ${randomUUID()}`,
    address: "Адрес объекта логиста",
    branch: "Куст объекта логиста",
    customer: tradeName,
    clientId,
    manager: "Менеджер объекта логиста",
    director: "Руководитель объекта логиста",
    project: "Проект объекта логиста",
  });
  assert.equal(createdSiteResponse.status, 201);
  const createdSite = (await createdSiteResponse.json()) as { id: string };
  createdSiteIds.push(createdSite.id);
  assert.equal((await request("/sites/bulk", "POST", {})).status, 403);
  assert.equal(
    (await request(`/sites/${siteId}/close`, "POST", {})).status,
    400,
  );
  assert.equal((await request(`/sites/${siteId}/reopen`, "POST")).status, 403);
  assert.equal((await request(`/sites/${siteId}`, "DELETE")).status, 403);

  actor = { ...logistician, role: "manager" };
  const managerDirectEdit = await request(`/sites/${siteId}`, "PATCH", {
    clientId: alternateClientId,
    branch: "Прямая правка руководителя",
  });
  assert.equal(managerDirectEdit.status, 200);
  const createdResponse = await request(
    `/sites/${siteId}/change-requests`,
    "POST",
    { branch: "Предложенный куст после прямой правки" },
  );
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()) as { id: string };
  assert.equal(
    (await db.select().from(sitesTable).where(eq(sitesTable.id, siteId)))[0]
      .branch,
    "Прямая правка руководителя",
  );
  assert.equal(
    (await request(`/site-change-requests/${created.id}/approve`, "POST"))
      .status,
    403,
  );

  actor = admin;
  assert.equal(
    (await request(`/site-change-requests/${created.id}/approve`, "POST"))
      .status,
    200,
  );
  assert.equal(
    (await db.select().from(sitesTable).where(eq(sitesTable.id, siteId)))[0]
      .branch,
    "Предложенный куст после прямой правки",
  );
  assert.equal(
    (await request(`/site-change-requests/${created.id}/approve`, "POST"))
      .status,
    409,
  );

  actor = logistician;
  const staleResponse = await request(
    `/sites/${siteId}/change-requests`,
    "POST",
    { branch: "Устаревшее предложение" },
  );
  assert.equal(staleResponse.status, 201);
  const stale = (await staleResponse.json()) as { id: string };
  actor = logistician;
  assert.equal(
    (
      await request(`/sites/${siteId}`, "PATCH", {
        clientId,
        branch: "Более свежая прямая правка логиста",
      })
    ).status,
    200,
  );
  actor = admin;
  assert.equal(
    (await request(`/site-change-requests/${stale.id}/approve`, "POST")).status,
    409,
  );
  assert.equal(
    (await db.select().from(sitesTable).where(eq(sitesTable.id, siteId)))[0]
      .branch,
    "Более свежая прямая правка логиста",
  );
  assert.equal(
    (await request(`/site-change-requests/${stale.id}/reject`, "POST")).status,
    200,
  );

  actor = logistician;
  const rejectedResponse = await request(
    `/sites/${siteId}/change-requests`,
    "POST",
    { manager: "Предложенный менеджер" },
  );
  assert.equal(rejectedResponse.status, 201);
  const rejected = (await rejectedResponse.json()) as { id: string };
  actor = admin;
  assert.equal(
    (await request(`/site-change-requests/${rejected.id}/reject`, "POST"))
      .status,
    200,
  );
  assert.equal(
    (await db.select().from(sitesTable).where(eq(sitesTable.id, siteId)))[0]
      .manager,
    "Новый менеджер",
  );
  assert.equal(
    (await request(`/site-change-requests/${rejected.id}/reject`, "POST"))
      .status,
    409,
  );
  assert.equal(
    (await db.select().from(siteChangeRequestsTable)).filter(
      (item) => item.siteId === siteId,
    ).length,
    3,
  );

  const [deletableSite] = await db
    .insert(sitesTable)
    .values({
      name: `Удаляемый объект ${randomUUID()}`,
      address: "Адрес",
      branch: "Куст",
      client: clientName,
      clientId,
      manager: "Менеджер",
      director: "Руководитель",
      project: "Проект",
    })
    .returning();
  actor = logistician;
  const beforeDeleteResponse = await request(
    `/sites/${deletableSite.id}/change-requests`,
    "POST",
    { manager: "Новый менеджер" },
  );
  assert.equal(beforeDeleteResponse.status, 201);
  const beforeDelete = (await beforeDeleteResponse.json()) as { id: string };
  actor = admin;
  assert.equal(
    (await request(`/sites/${deletableSite.id}`, "DELETE")).status,
    409,
  );
  assert.equal(
    (await request(`/site-change-requests/${beforeDelete.id}/reject`, "POST"))
      .status,
    200,
  );
  assert.equal(
    (await request(`/sites/${deletableSite.id}`, "DELETE")).status,
    204,
  );
  const [preservedRequest] = await db
    .select()
    .from(siteChangeRequestsTable)
    .where(eq(siteChangeRequestsTable.id, beforeDelete.id));
  assert.ok(preservedRequest);
  assert.equal(preservedRequest.status, "rejected");
  assert.equal(preservedRequest.siteId, null);
  assert.equal(preservedRequest.siteName, deletableSite.name);
});

test("закрытие логиста ждёт администратора, блокирует конкурентов и учитывает повторно открытый объект", async () => {
  const [closureSite] = await db
    .insert(sitesTable)
    .values({
      name: `Объект закрытия ${randomUUID()}`,
      address: "Адрес закрытия",
      branch: "Куст закрытия",
      client: clientName,
      clientId,
      manager: "Менеджер",
      director: "Руководитель",
      project: "Проект",
    })
    .returning();
  createdSiteIds.push(closureSite.id);
  const [closureDelivery] = await db
    .insert(deliveriesTable)
    .values({
      siteId: closureSite.id,
      plannedDate: "2027-02-01",
      actualDate: "2027-02-02",
      note: "Доставка сохраняется при выводе объекта из обслуживания",
    })
    .returning({ id: deliveriesTable.id });
  createdDeliveryIds.push(closureDelivery.id);
  const closureObjectPath = `/objects/site-closure-${randomUUID()}`;
  const [closureAct] = await db
    .insert(deliveryPhotosTable)
    .values({
      deliveryId: closureDelivery.id,
      objectPath: closureObjectPath,
      fileName: "Акт сохраняется.pdf",
      mimeType: "application/pdf",
      uploadedBy: "Тест сохранения",
    })
    .returning({ id: deliveryPhotosTable.id });
  createdDeliveryPhotoIds.push(closureAct.id);

  actor = logistician;
  const ordinaryProposal = await request(
    `/sites/${closureSite.id}/change-requests`,
    "POST",
    { manager: "Ожидающая обычная правка" },
  );
  assert.equal(ordinaryProposal.status, 201);
  const ordinaryCloseConflict = await request(
    `/sites/${closureSite.id}/close`,
    "POST",
    { closedFrom: "2027-02-01", reopenDate: null, reason: "Проверка" },
  );
  assert.equal(ordinaryCloseConflict.status, 409);
  assert.match(
    String(
      ((await ordinaryCloseConflict.json()) as { error?: unknown }).error,
    ),
    /ожидающее предложение/,
  );
  actor = admin;
  const ordinaryRequest = (await ordinaryProposal.json()) as { id: string };
  assert.equal(
    (await request(`/site-change-requests/${ordinaryRequest.id}/reject`, "POST"))
      .status,
    200,
  );

  actor = { ...logistician, role: "manager" };
  const closureResponse = await request(
    `/sites/${closureSite.id}/close`,
    "POST",
    {
      closedFrom: "2027-02-01",
      reopenDate: "2027-03-01",
      reason: "Проверка закрытия",
    },
  );
  assert.equal(closureResponse.status, 201);
  const closureDto = (await closureResponse.json()) as Record<string, any>;
  assert.equal(closureDto.isClosed, false);
  assert.equal(
    closureDto.pendingClosureRequest.closureReason,
    "Проверка закрытия",
  );
  assert.equal(closureDto.pendingClosureRequest.reopenDate, null);
  assert.equal(closureDto.closedFrom, null);

  const [secondAuthor] = await db
    .insert(appUsersTable)
    .values({
      clerkUserId: `site-change-closure-author-${randomUUID()}`,
      email: `closure-author-${randomUUID()}@example.test`,
      name: "Второй логист закрытия",
      role: "logistician",
      editableSections: ["sites"],
    })
    .returning();
  closureAuthorIds.push(secondAuthor.id);
  actor = asAuthenticated(secondAuthor);
  const competingClosure = await request(
    `/sites/${closureSite.id}/close`,
    "POST",
    { closedFrom: "2027-04-01", reopenDate: null, reason: "Конкурирующий" },
  );
  assert.equal(competingClosure.status, 409);
  assert.match(
    String(((await competingClosure.json()) as { error?: unknown }).error),
    /ожидает подтверждения/,
  );

  actor = admin;
  const pending = (
    (await (
      await request("/site-change-requests?status=pending", "GET")
    ).json()) as Array<{ siteId: string; kind: string }>
  ).find((item) => item.siteId === closureSite.id);
  assert.ok(pending);
  assert.equal(pending.kind, "closure");
  const closureRequest = (
    (await db
      .select()
      .from(siteChangeRequestsTable)
      .where(eq(siteChangeRequestsTable.siteId, closureSite.id)))
  ).find((item) => item.status === "pending");
  assert.ok(closureRequest);
  await db
    .update(siteChangeRequestsTable)
    .set({
      payload: {
        kind: "closure",
        closedFrom: "2027-02-01",
        reopenDate: "2027-03-01",
        closureReason: "Проверка закрытия",
      },
    })
    .where(eq(siteChangeRequestsTable.id, closureRequest!.id));
  const legacyPendingSite = await request(`/sites/${closureSite.id}`, "GET");
  assert.equal(legacyPendingSite.status, 200);
  const legacyPendingDto = (await legacyPendingSite.json()) as Record<string, any>;
  assert.equal(legacyPendingDto.pendingClosureRequest.reopenDate, null);
  assert.equal(
    (await request(`/site-change-requests/${closureRequest!.id}/approve`, "POST"))
      .status,
    200,
  );
  const approvedSite = await request(`/sites/${closureSite.id}`, "GET");
  assert.equal(approvedSite.status, 200);
  const approvedDto = (await approvedSite.json()) as Record<string, any>;
  assert.equal(approvedDto.pendingClosureRequest, null);
  assert.match(String(approvedDto.closedFrom), /^2027-02-01/);
  assert.equal(approvedDto.reopenDate, null);
  assert.equal(approvedDto.isClosed, true);
  const [persistedApprovedSite] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.id, closureSite.id));
  assert.equal(persistedApprovedSite.reopenDate, null);
  const [retainedDelivery] = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, closureDelivery.id));
  assert.equal(
    retainedDelivery.note,
    "Доставка сохраняется при выводе объекта из обслуживания",
  );
  assert.equal(retainedDelivery.actualDate, "2027-02-02");
  const [retainedAct] = await db
    .select()
    .from(deliveryPhotosTable)
    .where(eq(deliveryPhotosTable.id, closureAct.id));
  assert.equal(retainedAct.objectPath, closureObjectPath);
  assert.equal(retainedAct.fileName, "Акт сохраняется.pdf");
  const [normalizedClosureRequest] = await db
    .select()
    .from(siteChangeRequestsTable)
    .where(eq(siteChangeRequestsTable.id, closureRequest!.id));
  assert.equal(
    (normalizedClosureRequest.payload as { reopenDate?: string | null })
      .reopenDate,
    null,
  );

  const [reopenedSite] = await db
    .insert(sitesTable)
    .values({
      name: `Объект повторного открытия ${randomUUID()}`,
      address: "Адрес",
      branch: "Куст",
      client: clientName,
      clientId,
      manager: "Менеджер",
      director: "Руководитель",
      project: "Проект",
      closedFrom: "2020-01-01",
      reopenDate: "2020-02-01",
      closureReason: "Старое закрытие",
    })
    .returning();
  createdSiteIds.push(reopenedSite.id);
  actor = logistician;
  const pastReopenIgnored = await request(
    `/sites/${reopenedSite.id}/close`,
    "POST",
    {
      closedFrom: "2027-05-01",
      reopenDate: "2020-02-01",
      reason: "Новое закрытие",
    },
  );
  assert.equal(pastReopenIgnored.status, 409);
  const pastReopenIgnoredError = (await pastReopenIgnored.json()) as {
    error?: string;
  };
  assert.match(String(pastReopenIgnoredError.error), /выведен из обслуживания/);
  actor = admin;
  const explicitReturn = await request(
    `/sites/${reopenedSite.id}/reopen`,
    "POST",
  );
  assert.equal(explicitReturn.status, 200);
  const explicitReturnDto = (await explicitReturn.json()) as Record<string, any>;
  assert.equal(explicitReturnDto.closedFrom, null);
  assert.equal(explicitReturnDto.reopenDate, null);
  assert.equal(explicitReturnDto.isClosed, false);
  actor = logistician;
  const afterReopen = await request(
    `/sites/${reopenedSite.id}/close`,
    "POST",
    {
      closedFrom: "2027-05-01",
      reopenDate: "2020-01-01",
      reason: "Новое закрытие",
    },
  );
  assert.equal(afterReopen.status, 201);
  actor = admin;
  const directClose = await request(`/sites/${reopenedSite.id}/close`, "POST", {
    closedFrom: "2027-06-01",
    reopenDate: "2020-02-01",
    reason: "Решение администратора",
  });
  assert.equal(directClose.status, 200);
  const directCloseDto = (await directClose.json()) as Record<string, any>;
  assert.equal(directCloseDto.reopenDate, null);
  assert.equal(directCloseDto.isClosed, true);
  const invalidatedClosure = (
    (await db
      .select()
      .from(siteChangeRequestsTable)
      .where(eq(siteChangeRequestsTable.siteId, reopenedSite.id)))
  ).find((item) => item.payload && "kind" in item.payload);
  assert.ok(invalidatedClosure);
  assert.equal(invalidatedClosure!.status, "rejected");
  assert.equal(
    (await request(`/sites/${reopenedSite.id}/reopen`, "POST")).status,
    200,
  );
});
