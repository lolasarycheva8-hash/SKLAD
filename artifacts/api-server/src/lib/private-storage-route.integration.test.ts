import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";

import {
  appUsersTable,
  clientsTable,
  db,
  deliveriesTable,
  deliveryPhotosTable,
  pool,
  sitesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import express from "express";

import storageRouter from "../routes/storage.ts";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "./objectStorage.ts";
import type { AuthenticatedAppUser } from "./user-roles.ts";

function testUser(
  role: AuthenticatedAppUser["role"],
  editableSections: AuthenticatedAppUser["editableSections"] = [],
): AuthenticatedAppUser {
  const now = new Date();
  return {
    id: randomUUID(),
    clerkUserId: `private-storage-${role}-${randomUUID()}`,
    email: `private-storage-${role}-${randomUUID()}@example.test`,
    name: `Тестовый ${role}`,
    phone: null,
    role,
    editableSections,
    isDriver: role === "driver",
    assignedSiteIds: null,
    createdAt: now,
    updatedAt: now,
  };
}

const logistician = testUser("logistician", ["deliveries"]);
const assignedDriver = testUser("driver");
const foreignDriver = testUser("driver");
const fixtureUserIds = [
  logistician.id,
  assignedDriver.id,
  foreignDriver.id,
];
const objectPath = `/objects/uploads/${randomUUID()}`;
const routePath = `/storage${objectPath}`;
const fileName = "Акт/водитель's (финал)\n.pdf";
const payload = "private delivery act";

let actor: AuthenticatedAppUser = logistician;
let baseUrl = "";
let clientId = "";
let siteId = "";
let deliveryId = "";
let photoId = "";
let storageObjectMissing = false;
const getObjectCalls: string[] = [];
const downloadCalls: unknown[] = [];

const originalGetObjectEntityFile =
  ObjectStorageService.prototype.getObjectEntityFile;
const originalDownloadObject = ObjectStorageService.prototype.downloadObject;
const fakeObjectFile = {
  name: "fixture-private-delivery-act",
} as Awaited<ReturnType<typeof originalGetObjectEntityFile>>;

ObjectStorageService.prototype.getObjectEntityFile = async function (
  requestedObjectPath,
) {
  getObjectCalls.push(requestedObjectPath);
  if (storageObjectMissing) {
    throw new ObjectNotFoundError();
  }
  return fakeObjectFile;
};

ObjectStorageService.prototype.downloadObject = async function (file) {
  downloadCalls.push(file);
  return new Response(payload, {
    headers: {
      "content-type": "application/pdf",
      "cache-control": "private, max-age=3600",
    },
  });
};

const app = express();
app.use((req, _res, next) => {
  req.appUser = actor;
  req.log = {
    info() {},
    warn() {},
    error() {},
  } as unknown as typeof req.log;
  next();
});
app.use(storageRouter);

const server = app.listen(0);

before(async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Integration tests must not run against production");
  }

  await new Promise<void>((resolve) => {
    if (server.listening) resolve();
    else server.once("listening", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db
    .insert(appUsersTable)
    .values([logistician, assignedDriver, foreignDriver]);
  const [client] = await db
    .insert(clientsTable)
    .values({ name: `Клиент private storage ${randomUUID()}` })
    .returning({ id: clientsTable.id, name: clientsTable.name });
  clientId = client.id;

  const [site] = await db
    .insert(sitesTable)
    .values({
      name: `Объект private storage ${randomUUID()}`,
      address: "Тестовый адрес",
      branch: "Тестовая ветка",
      client: client.name,
      clientId,
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
    })
    .returning({ id: deliveriesTable.id });
  deliveryId = delivery.id;

  const [photo] = await db
    .insert(deliveryPhotosTable)
    .values({
      deliveryId,
      objectPath,
      fileName,
      mimeType: "application/pdf",
      uploadedBy: "Интеграционный тест",
    })
    .returning({ id: deliveryPhotosTable.id });
  photoId = photo.id;
});

beforeEach(() => {
  actor = logistician;
  storageObjectMissing = false;
  getObjectCalls.length = 0;
  downloadCalls.length = 0;
});

after(async () => {
  ObjectStorageService.prototype.getObjectEntityFile =
    originalGetObjectEntityFile;
  ObjectStorageService.prototype.downloadObject = originalDownloadObject;

  if (photoId) {
    await db
      .delete(deliveryPhotosTable)
      .where(eq(deliveryPhotosTable.id, photoId));
  }
  if (deliveryId) {
    await db
      .delete(deliveriesTable)
      .where(eq(deliveriesTable.id, deliveryId));
  }
  if (siteId) {
    await db.delete(sitesTable).where(eq(sitesTable.id, siteId));
  }
  if (clientId) {
    await db.delete(clientsTable).where(eq(clientsTable.id, clientId));
  }
  await db
    .delete(appUsersTable)
    .where(inArray(appUsersTable.id, fixtureUserIds));

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await pool.end();
});

test("authorized logistician can view a registered private delivery act", async () => {
  const response = await fetch(`${baseUrl}${routePath}`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("content-disposition"), null);
  assert.equal(await response.text(), payload);
  assert.deepEqual(getObjectCalls, [objectPath]);
  assert.deepEqual(downloadCalls, [fakeObjectFile]);
});

test("download query uses the registered UTF-8 filename safely", async () => {
  const response = await fetch(`${baseUrl}${routePath}?download=1`);
  const safeName = fileName.replace(/[\u0000-\u001f\u007f/\\]/g, "_");
  const encodedName = encodeURIComponent(safeName).replace(
    /['()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-disposition"),
    `attachment; filename="delivery-act"; filename*=UTF-8''${encodedName}`,
  );
  assert.doesNotMatch(
    response.headers.get("content-disposition") ?? "",
    /[\r\nА-Яа-я]/,
  );
  assert.equal(await response.text(), payload);
  assert.equal(downloadCalls.length, 1);
});

test("HEAD checks registered storage existence without downloading", async () => {
  const response = await fetch(`${baseUrl}${routePath}`, { method: "HEAD" });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assert.deepEqual(getObjectCalls, [objectPath]);
  assert.equal(downloadCalls.length, 0);
});

test("unregistered and foreign private object access is denied before storage", async () => {
  const unregisteredPath = `/objects/uploads/${randomUUID()}`;
  const unregistered = await fetch(`${baseUrl}/storage${unregisteredPath}`);
  assert.equal(unregistered.status, 404);

  actor = foreignDriver;
  const foreign = await fetch(`${baseUrl}${routePath}`);
  assert.equal(foreign.status, 404);

  assert.equal(getObjectCalls.length, 0);
  assert.equal(downloadCalls.length, 0);
});

test("registered object missing from storage returns 404 without download", async () => {
  storageObjectMissing = true;
  const response = await fetch(`${baseUrl}${routePath}`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Object not found" });
  assert.deepEqual(getObjectCalls, [objectPath]);
  assert.equal(downloadCalls.length, 0);
});