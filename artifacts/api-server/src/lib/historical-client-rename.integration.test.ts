import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";

import express from "express";
import pg, { type PoolClient } from "pg";
import { pool } from "@workspace/db";

import clientsRouter from "../routes/clients.ts";
import type { AuthenticatedAppUser } from "./user-roles.ts";

const { Client } = pg;
const schemaName = `historical_client_rename_${randomUUID().replaceAll("-", "")}`;
const quotedSchema = `"${schemaName}"`;
const actor: AuthenticatedAppUser = {
  id: randomUUID(),
  clerkUserId: `test-${randomUUID()}`,
  email: `test-${randomUUID()}@example.test`,
  name: "Historical client rename administrator",
  phone: null,
  role: "admin",
  editableSections: [],
  isDriver: false,
  assignedSiteIds: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.appUser = actor;
  req.log = {
    error() {},
    warn() {},
    info() {},
  } as unknown as typeof req.log;
  next();
});
app.use(clientsRouter);

const server = app.listen(0);
let baseUrl = "";
let bootstrapClient: pg.Client | undefined;
let poolConnectError: Error | undefined;
const searchPathSetups: Promise<unknown>[] = [];

function setFixtureSearchPath(client: PoolClient): void {
  const setup = client
    .query(`SET search_path TO ${quotedSchema}, public`)
    .catch((error: unknown) => {
      poolConnectError =
        error instanceof Error ? error : new Error("Failed to set test search_path");
      throw error;
    });
  searchPathSetups.push(setup);
}

async function insertClient(name: string): Promise<string> {
  const id = randomUUID();
  await bootstrapClient!.query(
    `INSERT INTO ${quotedSchema}.clients (id, name) VALUES ($1, $2)`,
    [id, name],
  );
  return id;
}

async function insertSite(
  clientId: string | null,
  clientName: string,
): Promise<string> {
  const id = randomUUID();
  await bootstrapClient!.query(
    `INSERT INTO ${quotedSchema}.sites
       (id, name, address, branch, client, client_id, manager, director, project)
     VALUES ($1, $2, 'Address', 'Branch', $3, $4, 'Manager', 'Director', 'Project')`,
    [id, `Site ${id}`, clientName, clientId],
  );
  return id;
}

async function insertOrder(clientId: string): Promise<string> {
  const id = randomUUID();
  await bootstrapClient!.query(
    `INSERT INTO ${quotedSchema}.orders (id, client_id) VALUES ($1, $2)`,
    [id, clientId],
  );
  return id;
}

async function patchClient(
  clientId: string,
  name: string,
): Promise<Response> {
  if (poolConnectError) throw poolConnectError;
  return fetch(`${baseUrl}/clients/${clientId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

before(async () => {
  assert.notEqual(
    process.env.NODE_ENV,
    "production",
    "Integration tests must not run against production",
  );
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
  assert.equal(
    pool.totalCount,
    0,
    "The route pool must be unused so every connection can be isolated",
  );

  bootstrapClient = new Client({ connectionString: process.env.DATABASE_URL });
  await bootstrapClient.connect();
  await bootstrapClient.query(`CREATE SCHEMA ${quotedSchema}`);
  await bootstrapClient.query(`
    CREATE TABLE ${quotedSchema}.clients
      (LIKE public.clients INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY);
    CREATE TABLE ${quotedSchema}.sites
      (LIKE public.sites INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY);
    CREATE TABLE ${quotedSchema}.orders
      (LIKE public.orders INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY);

    ALTER TABLE ${quotedSchema}.sites ALTER COLUMN client_id DROP NOT NULL;
    ALTER TABLE ${quotedSchema}.clients
      ADD PRIMARY KEY (id),
      ADD CONSTRAINT fixture_clients_id_name_uq UNIQUE (id, name);
    ALTER TABLE ${quotedSchema}.sites
      ADD PRIMARY KEY (id),
      ADD CONSTRAINT fixture_sites_client_id_fk
        FOREIGN KEY (client_id) REFERENCES ${quotedSchema}.clients(id)
        ON DELETE RESTRICT,
      ADD CONSTRAINT fixture_sites_client_identity_fk
        FOREIGN KEY (client_id, client)
        REFERENCES ${quotedSchema}.clients(id, name)
        ON UPDATE CASCADE ON DELETE RESTRICT;
    ALTER TABLE ${quotedSchema}.orders
      ADD PRIMARY KEY (id),
      ADD CONSTRAINT fixture_orders_client_id_fk
        FOREIGN KEY (client_id) REFERENCES ${quotedSchema}.clients(id)
        ON DELETE RESTRICT;
  `);

  pool.on("connect", setFixtureSearchPath);
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  await bootstrapClient!.query(
    `TRUNCATE TABLE ${quotedSchema}.orders, ${quotedSchema}.sites, ${quotedSchema}.clients`,
  );
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  pool.off("connect", setFixtureSearchPath);
  try {
    await Promise.allSettled(searchPathSetups);
    await pool.end();
  } finally {
    if (bootstrapClient) {
      try {
        await bootstrapClient.query(
          `DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`,
        );
      } finally {
        await bootstrapClient.end();
      }
    }
  }
});

test("repairs one canonical duplicate by stable id without moving sites or orders", async () => {
  const oldName = "Historical Client";
  const duplicateName = " historical\u200B\u200C\u200D\u2060   client ";
  const selectedId = await insertClient(oldName);
  const duplicateId = await insertClient(duplicateName);
  const selectedSiteId = await insertSite(selectedId, oldName);
  const duplicateSiteId = await insertSite(duplicateId, duplicateName);
  const selectedOrderId = await insertOrder(selectedId);
  const duplicateOrderId = await insertOrder(duplicateId);

  const response = await patchClient(selectedId, "  Repaired\u00a0Client  ");
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    id: string;
    name: string;
    contact: string | null;
    siteCount: number;
    createdAt: string;
  };
  assert.equal(body.id, selectedId);
  assert.equal(body.name, "Repaired Client");
  assert.equal(body.contact, null);
  assert.equal(body.siteCount, 1);
  assert.ok(!Number.isNaN(Date.parse(body.createdAt)));

  const sites = await bootstrapClient!.query<{
    id: string;
    client: string;
    client_id: string | null;
  }>(
    `SELECT id, client, client_id
       FROM ${quotedSchema}.sites
      ORDER BY id`,
  );
  assert.deepEqual(
    new Map(sites.rows.map((site) => [site.id, [site.client, site.client_id]])),
    new Map([
      [selectedSiteId, ["Repaired Client", selectedId]],
      [duplicateSiteId, [duplicateName, duplicateId]],
    ]),
  );

  const orders = await bootstrapClient!.query<{
    id: string;
    client_id: string;
  }>(`SELECT id, client_id FROM ${quotedSchema}.orders ORDER BY id`);
  assert.deepEqual(
    new Map(orders.rows.map((order) => [order.id, order.client_id])),
    new Map([
      [selectedOrderId, selectedId],
      [duplicateOrderId, duplicateId],
    ]),
  );

  const repeated = await patchClient(selectedId, "Repaired Client");
  assert.equal(repeated.status, 200);
  const repeatedBody = (await repeated.json()) as {
    name: string;
    siteCount: number;
  };
  assert.equal(repeatedBody.name, "Repaired Client");
  assert.equal(repeatedBody.siteCount, 1);

  const conflict = await patchClient(selectedId, "HISTORICAL CLIENT");
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), {
    error: "Клиент с таким названием уже существует",
  });
});

test("rejects ambiguous duplicates when an unlinked legacy site matches", async () => {
  const oldName = "Ambiguous Legacy Client";
  const duplicateName = " ambiguous   legacy client ";
  const selectedId = await insertClient(oldName);
  const duplicateId = await insertClient(duplicateName);
  const selectedSiteId = await insertSite(selectedId, oldName);
  const orphanSiteName = "AMBIGUOUS LEGACY CLIENT";
  const orphanSiteId = await insertSite(null, orphanSiteName);
  const orderId = await insertOrder(selectedId);

  const response = await patchClient(selectedId, "Must Not Be Applied");
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error:
      "Нельзя переименовать клиента: несколько клиентов имеют одинаковое текущее название",
  });

  const clients = await bootstrapClient!.query<{ id: string; name: string }>(
    `SELECT id, name FROM ${quotedSchema}.clients ORDER BY id`,
  );
  assert.deepEqual(
    new Map(clients.rows.map((client) => [client.id, client.name])),
    new Map([
      [selectedId, oldName],
      [duplicateId, duplicateName],
    ]),
  );
  const sites = await bootstrapClient!.query<{
    id: string;
    client: string;
    client_id: string | null;
  }>(
    `SELECT id, client, client_id
       FROM ${quotedSchema}.sites
      ORDER BY id`,
  );
  assert.deepEqual(
    new Map(sites.rows.map((site) => [site.id, [site.client, site.client_id]])),
    new Map([
      [selectedSiteId, [oldName, selectedId]],
      [orphanSiteId, [orphanSiteName, null]],
    ]),
  );
  const order = await bootstrapClient!.query<{ client_id: string }>(
    `SELECT client_id FROM ${quotedSchema}.orders WHERE id = $1`,
    [orderId],
  );
  assert.equal(order.rows[0]?.client_id, selectedId);
});