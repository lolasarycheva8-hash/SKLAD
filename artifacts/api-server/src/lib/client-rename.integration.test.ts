import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";

import express from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  appUsersTable,
  canonicalClientNameSql,
  clientsTable,
  db,
  deliveryTypesTable,
  pool,
  sitesTable,
  tradeNamesTable,
} from "@workspace/db";

import clientsRouter from "../routes/clients.ts";
import sitesRouter from "../routes/sites.ts";
import { BULK_SITE_IMPORT_LOG_FIELD_NAMES } from "./bulk-site-import-log.ts";
import type { AuthenticatedAppUser } from "./user-roles.ts";

const actor: AuthenticatedAppUser = {
  id: randomUUID(),
  clerkUserId: `test-${randomUUID()}`,
  email: `test-${randomUUID()}@example.test`,
  name: "Тестовый администратор",
  phone: null,
  role: "admin",
  editableSections: [],
  isDriver: false,
  assignedSiteIds: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const app = express();
const observedBulkImportLogs: Array<Record<string, unknown>> = [];
app.use(express.json());
app.use((req, _res, next) => {
  req.appUser = actor;
  req.log = {
    error() {},
    warn() {},
    info(fields: unknown, message?: string) {
      if (
        message === "Bulk site import completed" &&
        typeof fields === "object" &&
        fields !== null
      ) {
        observedBulkImportLogs.push(fields as Record<string, unknown>);
      }
    },
  } as unknown as typeof req.log;
  next();
});
app.use(clientsRouter);
app.use(sitesRouter);

const server = app.listen(0);
let baseUrl = "";
let clientId = "";
let siteId = "";
let originalClientName = "";
let initialClientName = "";
let siteTradeName = "";
const createdClientIds: string[] = [];
const createdSiteIds: string[] = [];
const createdUserIds: string[] = [];
let observedBulkLookupQueries:
  | {
      clients: number;
      tradeNames: number;
      deliveryTypes: number;
      sites: number;
      users: number;
      writes: number;
    }
  | undefined;
let failNextBulkClientsLookup = false;
let failNextBulkDeliveryTypesLookup = false;
let failNextBulkTradeNamesLookup = false;
const instrumentedPoolClients = new WeakSet<object>();
let pauseNextSiteInsert:
  | {
      inserted: () => void;
      release: Promise<void>;
    }
  | undefined;

function beginBulkImportLogCapture(): void {
  observedBulkImportLogs.length = 0;
}

function bulkSiteItem(
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    address: "Тестовый адрес bulk",
    branch: "Тестовый куст bulk",
    clientId,
    manager: "Тестовый менеджер bulk",
    director: "Тестовый руководитель bulk",
    project: "Тестовый проект bulk",
    ...overrides,
  };
}

function assertBulkImportLog(
  expected: Partial<Record<(typeof BULK_SITE_IMPORT_LOG_FIELD_NAMES)[number], number>>,
): void {
  assert.equal(observedBulkImportLogs.length, 1);
  const [fields] = observedBulkImportLogs;
  assert.deepEqual(
    Object.keys(fields),
    [...BULK_SITE_IMPORT_LOG_FIELD_NAMES],
  );
  assert.ok(
    Object.values(fields).every((value) => typeof value === "number"),
  );
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(fields[name], value);
  }
  observedBulkImportLogs.length = 0;
}

pool.on("acquire", (client) => {
  if (instrumentedPoolClients.has(client)) return;
  instrumentedPoolClients.add(client);
  const originalQuery = client.query;
  client.query = ((query: unknown, ...args: unknown[]) => {
    const text =
      typeof query === "string"
        ? query
        : typeof query === "object" &&
            query !== null &&
            "text" in query &&
            typeof query.text === "string"
          ? query.text
          : "";
    if (
      observedBulkLookupQueries &&
      /^\s*select\b[\s\S]*\bfrom\s+"?clients"?\b/i.test(text)
    ) {
      observedBulkLookupQueries.clients += 1;
    }
    if (
      failNextBulkClientsLookup &&
      /^\s*select\b[\s\S]*\bfrom\s+"?clients"?\b/i.test(text)
    ) {
      failNextBulkClientsLookup = false;
      const failingQuery =
        typeof query === "object" && query !== null
          ? {
              ...query,
              text: "SELECT * FROM injected_missing_clients_lookup",
            }
          : "SELECT * FROM injected_missing_clients_lookup";
      return Reflect.apply(originalQuery, client, [failingQuery, ...args]);
    }
    if (
      observedBulkLookupQueries &&
      /^\s*select\b[\s\S]*\bfrom\s+"?trade_names"?\b/i.test(text)
    ) {
      observedBulkLookupQueries.tradeNames += 1;
    }
    if (
      failNextBulkTradeNamesLookup &&
      /^\s*select\b[\s\S]*\bfrom\s+"?trade_names"?\b/i.test(text)
    ) {
      failNextBulkTradeNamesLookup = false;
      const failingQuery =
        typeof query === "object" && query !== null
          ? {
              ...query,
              text: "SELECT * FROM injected_missing_trade_names_lookup",
            }
          : "SELECT * FROM injected_missing_trade_names_lookup";
      return Reflect.apply(originalQuery, client, [failingQuery, ...args]);
    }
    if (
      observedBulkLookupQueries &&
      /^\s*select\b[\s\S]*\bfrom\s+"?delivery_types"?\b/i.test(text)
    ) {
      observedBulkLookupQueries.deliveryTypes += 1;
    }
    if (
      failNextBulkDeliveryTypesLookup &&
      /^\s*select\b[\s\S]*\bfrom\s+"?delivery_types"?\b/i.test(text)
    ) {
      failNextBulkDeliveryTypesLookup = false;
      const failingQuery =
        typeof query === "object" && query !== null
          ? {
              ...query,
              text: "SELECT * FROM injected_missing_delivery_types_lookup",
            }
          : "SELECT * FROM injected_missing_delivery_types_lookup";
      return Reflect.apply(originalQuery, client, [failingQuery, ...args]);
    }
    if (
      observedBulkLookupQueries &&
      /^\s*select\b[\s\S]*\bfrom\s+"?sites"?\b/i.test(text)
    ) {
      observedBulkLookupQueries.sites += 1;
    }
    if (
      observedBulkLookupQueries &&
      /^\s*select\b[\s\S]*\bfrom\s+"?app_users"?\b/i.test(text)
    ) {
      observedBulkLookupQueries.users += 1;
    }
    if (
      observedBulkLookupQueries &&
      /^\s*insert\s+into\s+"?sites"?\b/i.test(text)
    ) {
      observedBulkLookupQueries.writes += 1;
    }
    if (
      pauseNextSiteInsert &&
      /^\s*insert\s+into\s+"?sites"?\b/i.test(text)
    ) {
      const pause = pauseNextSiteInsert;
      pauseNextSiteInsert = undefined;
      return Promise.resolve(
        Reflect.apply(originalQuery, client, [query, ...args]),
      ).then(async (result) => {
        pause.inserted();
        await pause.release;
        return result;
      });
    }
    return Reflect.apply(originalQuery, client, [query, ...args]);
  }) as typeof client.query;
});

function findPostgresConstraint(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    if ("constraint" in current && typeof current.constraint === "string") {
      return current.constraint;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

async function waitForBlockedTableLock(
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Array<{ pid: number }> }>,
  tableName: string,
  excludedPid?: number,
): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await query(
      `
        SELECT lock.pid
        FROM pg_locks AS lock
        JOIN pg_class AS relation ON relation.oid = lock.relation
        WHERE relation.relname = $1
          AND lock.mode = 'ShareRowExclusiveLock'
          AND lock.granted = false
          AND ($2::int IS NULL OR lock.pid <> $2)
        LIMIT 1
      `,
      [tableName, excludedPid ?? null],
    );
    const pid = result.rows[0]?.pid;
    if (pid !== undefined) return pid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for blocked lock on ${tableName}`);
}

before(async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Integration tests must not run against production");
  }
  await db.insert(appUsersTable).values(actor);

  const oldName = `Клиент до переименования ${randomUUID()}`;
  originalClientName = oldName;
  initialClientName = oldName;
  siteTradeName = `Торговое название объекта ${randomUUID()}`;
  await db.insert(tradeNamesTable).values({ name: siteTradeName });
  const [client] = await db
    .insert(clientsTable)
    .values({ name: oldName })
    .returning({ id: clientsTable.id });
  clientId = client.id;

  const [site] = await db
    .insert(sitesTable)
    .values({
      name: `Объект клиента ${randomUUID()}`,
      address: "Тестовый адрес",
      branch: "Тестовый куст",
      client: oldName,
      clientId: client.id,
      manager: "Тестовый менеджер",
      director: "Тестовый руководитель",
      project: "Тестовый проект",
    })
    .returning({ id: sitesTable.id });
  siteId = site.id;

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  for (const id of createdSiteIds) {
    await db.delete(sitesTable).where(eq(sitesTable.id, id));
  }
  if (siteId) await db.delete(sitesTable).where(eq(sitesTable.id, siteId));
  for (const id of createdClientIds) {
    await db.delete(clientsTable).where(eq(clientsTable.id, id));
  }
  if (clientId) {
    await db.delete(clientsTable).where(eq(clientsTable.id, clientId));
  }
  if (siteTradeName) {
    await db.delete(tradeNamesTable).where(eq(tradeNamesTable.name, siteTradeName));
  }
  await db
    .delete(appUsersTable)
    .where(inArray(appUsersTable.id, [...createdUserIds, actor.id]));
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await pool.end();
});

test("renaming a client keeps linked sites by stable id and updates display name", async () => {
  const newName = `Клиент после переименования ${randomUUID()}`;
  const response = await fetch(`${baseUrl}/clients/${clientId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: newName }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    name: string;
    siteCount: number;
  };
  assert.equal(body.name, newName);
  assert.equal(body.siteCount, 1);

  const [site] = await db
    .select({ client: sitesTable.client, clientId: sitesTable.clientId })
    .from(sitesTable)
    .where(eq(sitesTable.id, siteId));
  assert.equal(site.client, newName);
  assert.equal(site.clientId, clientId);

  const listResponse = await fetch(`${baseUrl}/clients`);
  assert.equal(listResponse.status, 200);
  const clients = (await listResponse.json()) as Array<{
    id: string;
    siteCount: number;
  }>;
  const renamedClient = clients.find(
    (client: { id: string }) => client.id === clientId,
  );
  assert.equal(renamedClient?.siteCount, 1);
  initialClientName = newName;
});

test("schema preserves client identity protection without the rollout migration", () => {
  const constraint = getTableConfig(sitesTable).foreignKeys.find(
    (key) => key.getName() === "sites_client_identity_fk",
  );
  assert.ok(constraint);
  assert.equal(constraint.onUpdate, "cascade");
  assert.equal(constraint.onDelete, "restrict");
  const reference = constraint.reference();
  assert.deepEqual(
    reference.columns.map((column) => column.name),
    ["client_id", "client"],
  );
  assert.equal(reference.foreignTable, clientsTable);
  assert.deepEqual(
    reference.foreignColumns.map((column) => column.name),
    ["id", "name"],
  );
  assert.equal(sitesTable.clientId.notNull, true);
});

test("sites reject a null client_id without a backfill step", async () => {
  const rejectedSiteName = `Null client SQL fixture ${randomUUID()}`;

  await assert.rejects(
    pool.query(
      `
        INSERT INTO sites (
          name, address, branch, client, client_id, manager, director, project
        )
        VALUES ($1, 'Адрес', 'Куст', $2, NULL, 'Менеджер', 'Руководитель', 'Проект')
      `,
      [rejectedSiteName, initialClientName],
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        (error as Error & { code?: string }).code,
        "23502",
      );
      assert.equal(
        (error as Error & { column?: string }).column,
        "client_id",
      );
      return true;
    },
  );

  const rejectedInsert = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM sites WHERE name = $1",
    [rejectedSiteName],
  );
  assert.equal(rejectedInsert.rows[0]?.count, 0);
});

test("database protection rejects stale client names from direct SQL and cascades renames", async () => {
  const firstClientName = `Канонический клиент ${randomUUID()}`;
  const secondClientName = `Новый канонический клиент ${randomUUID()}`;
  const [firstClient] = await db
    .insert(clientsTable)
    .values({ name: firstClientName })
    .returning({ id: clientsTable.id });
  const [secondClient] = await db
    .insert(clientsTable)
    .values({ name: secondClientName })
    .returning({ id: clientsTable.id });
  createdClientIds.push(firstClient.id, secondClient.id);

  const rejectedSiteName = `Отклонённый SQL fixture ${randomUUID()}`;
  await assert.rejects(
    pool.query(
      `
        INSERT INTO sites (
          name, address, branch, client, client_id, manager, director, project
        )
        VALUES ($1, 'Адрес', 'Куст', 'Устаревшее имя', $2, 'Менеджер', 'Руководитель', 'Проект')
      `,
      [rejectedSiteName, firstClient.id],
    ),
    (error) =>
      findPostgresConstraint(error) === "sites_client_identity_fk",
  );
  const rejectedInsert = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM sites WHERE name = $1",
    [rejectedSiteName],
  );
  assert.equal(rejectedInsert.rows[0]?.count, 0);

  const inserted = await pool.query<{ id: string; client: string }>(
    `
      INSERT INTO sites (
        name, address, branch, client, client_id, manager, director, project
      )
      VALUES ($1, 'Адрес', 'Куст', $2, $3, 'Менеджер', 'Руководитель', 'Проект')
      RETURNING id, client
    `,
    [`SQL fixture ${randomUUID()}`, firstClientName, firstClient.id],
  );
  const directSite = inserted.rows[0];
  assert.ok(directSite);
  createdSiteIds.push(directSite.id);
  assert.equal(directSite.client, firstClientName);

  await assert.rejects(
    pool.query(
      `
        UPDATE sites
        SET client_id = $1, client = 'Ещё одно устаревшее имя'
        WHERE id = $2
      `,
      [secondClient.id, directSite.id],
    ),
    (error) =>
      findPostgresConstraint(error) === "sites_client_identity_fk",
  );
  const unchanged = await pool.query<{ clientId: string; client: string }>(
    `
      SELECT client_id AS "clientId", client
      FROM sites
      WHERE id = $1
    `,
    [directSite.id],
  );
  assert.equal(unchanged.rows[0]?.clientId, firstClient.id);
  assert.equal(unchanged.rows[0]?.client, firstClientName);

  const rebound = await pool.query<{ client: string }>(
    `
      UPDATE sites
      SET client_id = $1, client = $2
      WHERE id = $3
      RETURNING client
    `,
    [secondClient.id, secondClientName, directSite.id],
  );
  assert.equal(rebound.rows[0]?.client, secondClientName);

  const renamedClientName = `Переименованный клиент ${randomUUID()}`;
  await pool.query("UPDATE clients SET name = $1 WHERE id = $2", [
    renamedClientName,
    secondClient.id,
  ]);
  const [renamedSite] = await db
    .select({ client: sitesTable.client, clientId: sitesTable.clientId })
    .from(sitesTable)
    .where(eq(sitesTable.id, directSite.id));
  assert.equal(renamedSite.clientId, secondClient.id);
  assert.equal(renamedSite.client, renamedClientName);
});

test("legacy text-only update cannot rebind a site after the old client name is reused", async () => {
  const [replacementClient] = await db
    .insert(clientsTable)
    .values({ name: originalClientName })
    .returning({ id: clientsTable.id });
  createdClientIds.push(replacementClient.id);

  const response = await fetch(`${baseUrl}/sites/${siteId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client: originalClientName,
      manager: "Менеджер из устаревшей формы",
    }),
  });
  assert.equal(response.status, 400);

  const [site] = await db
    .select({ clientId: sitesTable.clientId })
    .from(sitesTable)
    .where(eq(sitesTable.id, siteId));
  assert.equal(site.clientId, clientId);
});

test("unchanged clientId update is a successful no-op", async () => {
  const [siteBefore] = await db
    .select({ client: sitesTable.client, clientId: sitesTable.clientId })
    .from(sitesTable)
    .where(eq(sitesTable.id, siteId));
  const response = await fetch(`${baseUrl}/sites/${siteId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId: siteBefore.clientId }),
  });
  assert.equal(response.status, 200);
  const updated = (await response.json()) as {
    client: string;
    clientId: string | null;
  };
  assert.equal(updated.client, siteBefore.client);
  assert.equal(updated.clientId, siteBefore.clientId);
});

test("deleting a client linked by id returns a conflict", async () => {
  const [client] = await db
    .select({ name: clientsTable.name })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  assert.ok(client);

  const response = await fetch(`${baseUrl}/clients/${clientId}`, {
    method: "DELETE",
  });
  assert.equal(response.status, 409);
  const conflict = (await response.json()) as {
    error: string;
    code: string;
    blockingSites: {
      count: number;
      preview: Array<{ id: string; name: string }>;
    };
  };
  assert.equal(
    conflict.error,
    "Нельзя удалить клиента, пока к нему привязаны объекты",
  );
  assert.equal(conflict.code, "CLIENT_HAS_SITES");
  assert.equal(conflict.blockingSites.count, 1);
  assert.equal(conflict.blockingSites.preview.length, 1);
  assert.equal(conflict.blockingSites.preview[0]?.id, siteId);
  assert.ok(conflict.blockingSites.preview[0]?.name);

  const [stillExisting] = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  assert.equal(stillExisting?.id, clientId);
});

test("creating a site derives its display name from clientId", async () => {
  const [client] = await db
    .select({ name: clientsTable.name })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  assert.ok(client);

  const response = await fetch(`${baseUrl}/sites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `Объект с clientId ${randomUUID()}`,
      address: "Тестовый адрес",
      branch: "Тестовый куст",
      client: "Устаревшее имя из формы",
      customer: siteTradeName,
      clientId,
      manager: "Тестовый менеджер",
      director: "Тестовый руководитель",
      project: "Тестовый проект",
    }),
  });
  assert.equal(response.status, 201);
  const created = (await response.json()) as {
    id: string;
    client: string;
    clientId: string;
  };
  createdSiteIds.push(created.id);
  assert.equal(created.client, client.name);
  assert.equal(created.clientId, clientId);
});

test("site creation permissions allow only admins and logisticians with sites access", async () => {
  const originalRole = actor.role;
  const originalEditableSections = actor.editableSections;
  const validBody = (name: string) => ({
    name,
    address: "Тестовый адрес прав создания",
    branch: "Тестовый куст прав создания",
    customer: siteTradeName,
    clientId,
    manager: "Тестовый менеджер прав создания",
    director: "Тестовый руководитель прав создания",
    project: "Тестовый проект прав создания",
  });

  try {
    actor.role = "logistician";
    actor.editableSections = ["sites"];
    const logisticianSiteName = `Объект логиста ${randomUUID()}`;
    const logisticianResponse = await fetch(`${baseUrl}/sites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody(logisticianSiteName)),
    });
    assert.equal(logisticianResponse.status, 201);
    const logisticianSite = (await logisticianResponse.json()) as { id: string };
    createdSiteIds.push(logisticianSite.id);
    const [persisted] = await db
      .select({ id: sitesTable.id })
      .from(sitesTable)
      .where(eq(sitesTable.id, logisticianSite.id));
    assert.equal(persisted?.id, logisticianSite.id);

    const invalidResponse = await fetch(`${baseUrl}/sites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `Неполный объект ${randomUUID()}` }),
    });
    assert.equal(invalidResponse.status, 400);

    const bulkResponse = await fetch(`${baseUrl}/sites/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [validBody(`Bulk логиста ${randomUUID()}`)] }),
    });
    assert.equal(bulkResponse.status, 403);

    const deleteResponse = await fetch(`${baseUrl}/sites/${siteId}`, {
      method: "DELETE",
    });
    assert.equal(deleteResponse.status, 403);

    actor.editableSections = [];
    const noSitesResponse = await fetch(`${baseUrl}/sites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody(`Объект логиста без прав ${randomUUID()}`)),
    });
    assert.equal(noSitesResponse.status, 403);

    actor.role = "manager";
    actor.editableSections = ["sites"];
    const managerResponse = await fetch(`${baseUrl}/sites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody(`Объект менеджера ${randomUUID()}`)),
    });
    assert.equal(managerResponse.status, 403);

    actor.role = "driver";
    const driverResponse = await fetch(`${baseUrl}/sites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody(`Объект водителя ${randomUUID()}`)),
    });
    assert.equal(driverResponse.status, 403);
  } finally {
    actor.role = originalRole;
    actor.editableSections = originalEditableSections;
  }
});

test("site creation returns 400 without a partial insert when its driver is deleted concurrently", async () => {
  const [driver] = await db
    .insert(appUsersTable)
    .values({
      clerkUserId: `test-driver-${randomUUID()}`,
      email: `test-driver-${randomUUID()}@example.test`,
      name: "Удаляемый при создании объекта водитель",
      role: "driver",
      isDriver: true,
    })
    .returning({ id: appUsersTable.id });
  createdUserIds.push(driver.id);
  const siteName = `Объект гонки создания водителя ${randomUUID()}`;
  const blocker = await pool.connect();
  let barrierReleased = false;
  let createRequest: Promise<Response> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE clients IN ACCESS EXCLUSIVE MODE");
    createRequest = fetch(`${baseUrl}/sites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: siteName,
        address: "Адрес неудачного создания",
        branch: "Куст неудачного создания",
        customer: siteTradeName,
        clientId,
        manager: "Менеджер неудачного создания",
        director: "Руководитель неудачного создания",
        project: "Проект неудачного создания",
        driverUserId: driver.id,
      }),
    });
    await waitForBlockedTableLock(blocker.query.bind(blocker), "clients");
    const deletedDrivers = await db
      .delete(appUsersTable)
      .where(eq(appUsersTable.id, driver.id))
      .returning({ id: appUsersTable.id });
    assert.deepEqual(deletedDrivers, [{ id: driver.id }]);
    await blocker.query("COMMIT");
    barrierReleased = true;

    const response = await createRequest;
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Выбранный пользователь не является водителем",
    });
    const [persistedSite] = await db
      .select({ id: sitesTable.id })
      .from(sitesTable)
      .where(eq(sitesTable.name, siteName));
    assert.equal(persistedSite, undefined);
  } finally {
    if (!barrierReleased) {
      await blocker.query("ROLLBACK").catch(() => undefined);
    }
    await Promise.allSettled(
      [createRequest].filter(
        (request): request is Promise<Response> => request !== undefined,
      ),
    );
    blocker.release();
    await db.delete(sitesTable).where(eq(sitesTable.name, siteName));
    await db.delete(appUsersTable).where(eq(appUsersTable.id, driver.id));
  }
});

test("site update returns 400 without partial changes when its driver is deleted concurrently", async () => {
  const [driver] = await db
    .insert(appUsersTable)
    .values({
      clerkUserId: `test-driver-${randomUUID()}`,
      email: `test-driver-${randomUUID()}@example.test`,
      name: "Удаляемый при изменении объекта водитель",
      role: "driver",
      isDriver: true,
    })
    .returning({ id: appUsersTable.id });
  createdUserIds.push(driver.id);
  const originalAddress = `Адрес до гонки ${randomUUID()}`;
  const [site] = await db
    .insert(sitesTable)
    .values({
      name: `Объект гонки изменения водителя ${randomUUID()}`,
      address: originalAddress,
      branch: "Куст до гонки",
      client: initialClientName,
      clientId,
      manager: "Менеджер до гонки",
      director: "Руководитель до гонки",
      project: "Проект до гонки",
    })
    .returning({ id: sitesTable.id });
  createdSiteIds.push(site.id);
  const blocker = await pool.connect();
  let barrierReleased = false;
  let updateRequest: Promise<Response> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE clients IN ACCESS EXCLUSIVE MODE");
    updateRequest = fetch(`${baseUrl}/sites/${site.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId,
        address: "Адрес, который не должен сохраниться",
        driverUserId: driver.id,
      }),
    });
    await waitForBlockedTableLock(blocker.query.bind(blocker), "clients");
    const deletedDrivers = await db
      .delete(appUsersTable)
      .where(eq(appUsersTable.id, driver.id))
      .returning({ id: appUsersTable.id });
    assert.deepEqual(deletedDrivers, [{ id: driver.id }]);
    await blocker.query("COMMIT");
    barrierReleased = true;

    const response = await updateRequest;
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Выбранный пользователь не является водителем",
    });
    const [persistedSite] = await db
      .select({
        address: sitesTable.address,
        driverUserId: sitesTable.driverUserId,
      })
      .from(sitesTable)
      .where(eq(sitesTable.id, site.id));
    assert.deepEqual(persistedSite, {
      address: originalAddress,
      driverUserId: null,
    });
  } finally {
    if (!barrierReleased) {
      await blocker.query("ROLLBACK").catch(() => undefined);
    }
    await Promise.allSettled(
      [updateRequest].filter(
        (request): request is Promise<Response> => request !== undefined,
      ),
    );
    blocker.release();
    await db.delete(sitesTable).where(eq(sitesTable.id, site.id));
    await db.delete(appUsersTable).where(eq(appUsersTable.id, driver.id));
  }
});

test("site creation rejects a legacy client name without clientId", async () => {
  const response = await fetch(`${baseUrl}/sites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `Legacy-объект ${randomUUID()}`,
      address: "Тестовый адрес",
      branch: "Тестовый куст",
      client: initialClientName,
      manager: "Тестовый менеджер",
      director: "Тестовый руководитель",
      project: "Тестовый проект",
    }),
  });
  assert.equal(response.status, 400);
});

test("site update rejects a partial body without clientId", async () => {
  const response = await fetch(`${baseUrl}/sites/${siteId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ manager: "Новый менеджер" }),
  });
  assert.equal(response.status, 400);
});

test("bulk site import rejects a missing clientId without partial writes", async () => {
  const [client] = await db
    .select({ name: clientsTable.name })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  assert.ok(client);
  const validSiteName = `Допустимая строка импорта ${randomUUID()}`;
  beginBulkImportLogCapture();
  const response = await fetch(`${baseUrl}/sites/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [
        {
          name: validSiteName,
          address: "Тестовый адрес",
          branch: "Тестовый куст",
          clientId,
          manager: "Тестовый менеджер",
          director: "Тестовый руководитель",
          project: "Тестовый проект",
        },
        {
          name: `Неверная строка импорта ${randomUUID()}`,
          address: "Тестовый адрес",
          branch: "Тестовый куст",
          manager: "Тестовый менеджер",
          director: "Тестовый руководитель",
          project: "Тестовый проект",
        },
      ],
    }),
  });
  assert.equal(response.status, 400);
  assertBulkImportLog({
    rowCount: 0,
    writeBatchCount: 0,
    writeDurationMs: 0,
    succeeded: 0,
  });
  const [partiallyCreated] = await db
    .select({ id: sitesTable.id })
    .from(sitesTable)
    .where(eq(sitesTable.name, validSiteName));
  assert.equal(partiallyCreated, undefined);
});

test("bulk site import logs a reference-data validation failure without partial writes", async () => {
  const importedSiteNames = [
    `Допустимая строка до ошибки справочника ${randomUUID()}`,
    `Строка с неизвестным торговым названием ${randomUUID()}`,
  ];
  const unknownTradeName = `Неизвестное торговое название ${randomUUID()}`;
  const items = [
    bulkSiteItem(importedSiteNames[0]),
    bulkSiteItem(importedSiteNames[1], { customer: unknownTradeName }),
  ];

  beginBulkImportLogCapture();
  const response = await fetch(`${baseUrl}/sites/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });

  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, new RegExp(unknownTradeName));
  assertBulkImportLog({
    rowCount: items.length,
    writeBatchCount: 0,
    writeDurationMs: 0,
    succeeded: 0,
  });

  const persistedSites = await db
    .select({ name: sitesTable.name })
    .from(sitesTable)
    .where(inArray(sitesTable.name, importedSiteNames));
  assert.deepEqual(persistedSites, []);
});

test("bulk site import logs a database reference lookup failure without creating or updating sites", async () => {
  const existingSiteName = `Объект до сбоя чтения справочника ${randomUUID()}`;
  const newSiteName = `Новый объект при сбое чтения справочника ${randomUUID()}`;
  const originalAddress = "Адрес до сбоя чтения справочника";
  const [existingSite] = await db
    .insert(sitesTable)
    .values({
      name: existingSiteName,
      address: originalAddress,
      branch: "Куст до сбоя",
      client: initialClientName,
      clientId,
      manager: "Менеджер до сбоя",
      director: "Руководитель до сбоя",
      project: "Проект до сбоя",
    })
    .returning({ id: sitesTable.id });
  createdSiteIds.push(existingSite.id);
  const items = [
    bulkSiteItem(existingSiteName, {
      id: existingSite.id,
      address: "Адрес, который не должен сохраниться",
      customer: `Торговое название для сбоя ${randomUUID()}`,
    }),
    bulkSiteItem(newSiteName),
  ];

  beginBulkImportLogCapture();
  failNextBulkTradeNamesLookup = true;
  try {
    const response = await fetch(`${baseUrl}/sites/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });

    assert.equal(response.status, 500);
    assertBulkImportLog({
      rowCount: items.length,
      writeBatchCount: 0,
      writeDurationMs: 0,
      succeeded: 0,
    });
  } finally {
    failNextBulkTradeNamesLookup = false;
  }

  const persistedSites = await db
    .select({ name: sitesTable.name, address: sitesTable.address })
    .from(sitesTable)
    .where(inArray(sitesTable.name, [existingSiteName, newSiteName]));
  assert.deepEqual(persistedSites, [
    { name: existingSiteName, address: originalAddress },
  ]);
});

test("bulk site import logs a client lookup failure without creating or updating sites", async () => {
  const existingSiteName = `Объект до сбоя чтения клиентов ${randomUUID()}`;
  const newSiteName = `Новый объект при сбое чтения клиентов ${randomUUID()}`;
  const originalAddress = "Адрес до сбоя чтения клиентов";
  const [existingSite] = await db
    .insert(sitesTable)
    .values({
      name: existingSiteName,
      address: originalAddress,
      branch: "Куст до сбоя чтения клиентов",
      client: initialClientName,
      clientId,
      manager: "Менеджер до сбоя чтения клиентов",
      director: "Руководитель до сбоя чтения клиентов",
      project: "Проект до сбоя чтения клиентов",
    })
    .returning({ id: sitesTable.id });
  createdSiteIds.push(existingSite.id);
  const items = [
    bulkSiteItem(existingSiteName, {
      id: existingSite.id,
      address: "Адрес, который не должен сохраниться",
    }),
    bulkSiteItem(newSiteName),
  ];

  beginBulkImportLogCapture();
  failNextBulkClientsLookup = true;
  try {
    const response = await fetch(`${baseUrl}/sites/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });

    assert.equal(response.status, 500);
    assertBulkImportLog({
      rowCount: items.length,
      writeBatchCount: 0,
      succeeded: 0,
    });
  } finally {
    failNextBulkClientsLookup = false;
  }

  const persistedSites = await db
    .select({ name: sitesTable.name, address: sitesTable.address })
    .from(sitesTable)
    .where(inArray(sitesTable.name, [existingSiteName, newSiteName]));
  assert.deepEqual(persistedSites, [
    { name: existingSiteName, address: originalAddress },
  ]);
});

test("bulk site import logs a delivery type lookup failure after reading trade names", async () => {
  const existingSiteName = `Объект до сбоя чтения типов поставки ${randomUUID()}`;
  const newSiteName = `Новый объект при сбое чтения типов поставки ${randomUUID()}`;
  const originalAddress = "Адрес до сбоя чтения типов поставки";
  const knownTradeName = `Торговое название до сбоя типов поставки ${randomUUID()}`;
  await db.insert(tradeNamesTable).values({ name: knownTradeName });
  const [existingSite] = await db
    .insert(sitesTable)
    .values({
      name: existingSiteName,
      address: originalAddress,
      branch: "Куст до сбоя чтения типов поставки",
      client: initialClientName,
      clientId,
      manager: "Менеджер до сбоя чтения типов поставки",
      director: "Руководитель до сбоя чтения типов поставки",
      project: "Проект до сбоя чтения типов поставки",
    })
    .returning({ id: sitesTable.id });
  createdSiteIds.push(existingSite.id);
  const items = [
    bulkSiteItem(existingSiteName, {
      id: existingSite.id,
      address: "Адрес, который не должен сохраниться",
      customer: knownTradeName,
      deliveryType: `Тип поставки для сбоя ${randomUUID()}`,
    }),
    bulkSiteItem(newSiteName),
  ];

  observedBulkLookupQueries = {
    clients: 0,
    tradeNames: 0,
    deliveryTypes: 0,
    sites: 0,
    users: 0,
    writes: 0,
  };
  beginBulkImportLogCapture();
  failNextBulkDeliveryTypesLookup = true;
  try {
    const response = await fetch(`${baseUrl}/sites/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });

    assert.equal(response.status, 500);
    assertBulkImportLog({
      rowCount: items.length,
      writeBatchCount: 0,
      writeDurationMs: 0,
      succeeded: 0,
    });
    assert.equal(observedBulkLookupQueries.tradeNames, 1);
    assert.equal(observedBulkLookupQueries.deliveryTypes, 1);
    assert.equal(observedBulkLookupQueries.writes, 0);
  } finally {
    failNextBulkDeliveryTypesLookup = false;
    observedBulkLookupQueries = undefined;
    await db
      .delete(tradeNamesTable)
      .where(eq(tradeNamesTable.name, knownTradeName));
  }

  const persistedSites = await db
    .select({ name: sitesTable.name, address: sitesTable.address })
    .from(sitesTable)
    .where(inArray(sitesTable.name, [existingSiteName, newSiteName]));
  assert.deepEqual(persistedSites, [
    { name: existingSiteName, address: originalAddress },
  ]);
});

test("bulk site import logs an unknown delivery type without partial writes", async () => {
  const importedSiteNames = [
    `Допустимая строка до неизвестного типа поставки ${randomUUID()}`,
    `Строка с неизвестным типом поставки ${randomUUID()}`,
  ];
  const unknownDeliveryType = `Неизвестный тип поставки ${randomUUID()}`;
  const items = [
    bulkSiteItem(importedSiteNames[0]),
    bulkSiteItem(importedSiteNames[1], {
      deliveryType: unknownDeliveryType,
    }),
  ];

  beginBulkImportLogCapture();
  const response = await fetch(`${baseUrl}/sites/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });

  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, new RegExp(unknownDeliveryType));
  assertBulkImportLog({
    rowCount: items.length,
    writeBatchCount: 0,
    writeDurationMs: 0,
    succeeded: 0,
  });

  const persistedSites = await db
    .select({ name: sitesTable.name })
    .from(sitesTable)
    .where(inArray(sitesTable.name, importedSiteNames));
  assert.deepEqual(persistedSites, []);
});

test("bulk site import renames strictly by id without creating a duplicate and preserves mixed input order", async () => {
  const oldName = `Объект до bulk-переименования ${randomUUID()}`;
  const newName = `Объект после bulk-переименования ${randomUUID()}`;
  const insertedName = `Новый объект смешанного bulk-импорта ${randomUUID()}`;
  const [existing] = await db
    .insert(sitesTable)
    .values({
      name: oldName,
      address: "Старый адрес",
      branch: "Старый куст",
      client: initialClientName,
      clientId,
      manager: "Старый менеджер",
      director: "Старый руководитель",
      project: "Старый проект",
    })
    .returning({ id: sitesTable.id });
  createdSiteIds.push(existing.id);

  const response = await fetch(`${baseUrl}/sites/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [
        bulkSiteItem(newName, { id: existing.id, address: "Новый адрес" }),
        bulkSiteItem(insertedName),
      ],
    }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as Array<{
    id: string;
    name: string;
    address: string;
  }>;
  createdSiteIds.push(body[1].id);
  assert.deepEqual(
    body.map(({ id, name }) => ({ id, name })),
    [
      { id: existing.id, name: newName },
      { id: body[1].id, name: insertedName },
    ],
  );
  assert.equal(body[0].address, "Новый адрес");
  const matching = await db
    .select({ id: sitesTable.id, name: sitesTable.name })
    .from(sitesTable)
    .where(inArray(sitesTable.name, [oldName, newName]));
  assert.deepEqual(matching, [{ id: existing.id, name: newName }]);
});

test("bulk site import rejects a missing site id and rolls back all rows", async () => {
  const insertedName = `Строка до отсутствующего ID ${randomUUID()}`;
  const response = await fetch(`${baseUrl}/sites/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [
        bulkSiteItem(insertedName),
        bulkSiteItem(`Несуществующий объект ${randomUUID()}`, {
          id: randomUUID(),
        }),
      ],
    }),
  });
  assert.equal(response.status, 400);
  const [partiallyCreated] = await db
    .select({ id: sitesTable.id })
    .from(sitesTable)
    .where(eq(sitesTable.name, insertedName));
  assert.equal(partiallyCreated, undefined);
});

test("bulk site import rejects a repeated explicit site id", async () => {
  const response = await fetch(`${baseUrl}/sites/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [
        bulkSiteItem(`Первое повторение ID ${randomUUID()}`, { id: siteId }),
        bulkSiteItem(`Второе повторение ID ${randomUUID()}`, {
          id: siteId.toUpperCase(),
        }),
      ],
    }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "ID объекта повторяется в файле",
  });
});

test("bulk site import returns conflict on rename to another site's name and rolls back", async () => {
  const firstName = `Первый объект конфликта ${randomUUID()}`;
  const secondName = `Второй объект конфликта ${randomUUID()}`;
  const existing = await db
    .insert(sitesTable)
    .values(
      [firstName, secondName].map((name) => ({
        name,
        address: "Исходный адрес",
        branch: "Исходный куст",
        client: initialClientName,
        clientId,
        manager: "Исходный менеджер",
        director: "Исходный руководитель",
        project: "Исходный проект",
      })),
    )
    .returning({ id: sitesTable.id, name: sitesTable.name });
  createdSiteIds.push(...existing.map(({ id }) => id));
  const first = existing.find(({ name }) => name === firstName);
  assert.ok(first);

  const response = await fetch(`${baseUrl}/sites/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [
        bulkSiteItem(`Не должна сохраниться ${randomUUID()}`),
        bulkSiteItem(secondName, { id: first.id }),
      ],
    }),
  });
  assert.equal(response.status, 409);
  const persisted = await db
    .select({ id: sitesTable.id, name: sitesTable.name })
    .from(sitesTable)
    .where(inArray(sitesTable.id, existing.map(({ id }) => id)));
  assert.deepEqual(
    persisted.sort((a, b) => a.id.localeCompare(b.id)),
    existing.sort((a, b) => a.id.localeCompare(b.id)),
  );
});

test("bulk site import rejects an explicit and name-only row targeting the same name before any writes", async () => {
  const existingName = `Объект неоднозначного импорта ${randomUUID()}`;
  const newName = `Новая строка неоднозначного импорта ${randomUUID()}`;
  const [existing] = await db
    .insert(sitesTable)
    .values({
      name: existingName,
      address: "Исходный адрес",
      branch: "Исходный куст",
      client: initialClientName,
      clientId,
      manager: "Исходный менеджер",
      director: "Исходный руководитель",
      project: "Исходный проект",
    })
    .returning({ id: sitesTable.id });
  createdSiteIds.push(existing.id);

  const response = await fetch(`${baseUrl}/sites/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [
        bulkSiteItem(existingName, { id: existing.id, address: "Адрес ID" }),
        bulkSiteItem(existingName, { address: "Адрес без ID" }),
        bulkSiteItem(newName),
      ],
    }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: `Неоднозначный импорт: объект «${existingName}» указан одновременно с ID и без ID`,
  });

  const persisted = await db
    .select({
      id: sitesTable.id,
      name: sitesTable.name,
      address: sitesTable.address,
    })
    .from(sitesTable)
    .where(inArray(sitesTable.name, [existingName, newName]));
  assert.deepEqual(persisted, [
    { id: existing.id, name: existingName, address: "Исходный адрес" },
  ]);
});

test("bulk site import resolves name-only rows against the pre-write snapshot", async () => {
  const oldName = `Объект snapshot до переименования ${randomUUID()}`;
  const renamedName = `Объект snapshot после переименования ${randomUUID()}`;
  const [existing] = await db
    .insert(sitesTable)
    .values({
      name: oldName,
      address: "Исходный адрес",
      branch: "Исходный куст",
      client: initialClientName,
      clientId,
      manager: "Исходный менеджер",
      director: "Исходный руководитель",
      project: "Исходный проект",
    })
    .returning({ id: sitesTable.id });
  createdSiteIds.push(existing.id);

  const response = await fetch(`${baseUrl}/sites/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [
        bulkSiteItem(renamedName, { id: existing.id }),
        bulkSiteItem(oldName, { address: "Адрес без ID" }),
      ],
    }),
  });
  assert.equal(response.status, 409);

  const persisted = await db
    .select({
      id: sitesTable.id,
      name: sitesTable.name,
      address: sitesTable.address,
    })
    .from(sitesTable)
    .where(inArray(sitesTable.id, [existing.id]));
  assert.deepEqual(persisted, [
    { id: existing.id, name: oldName, address: "Исходный адрес" },
  ]);
  const duplicate = await db
    .select({ id: sitesTable.id })
    .from(sitesTable)
    .where(eq(sitesTable.name, renamedName));
  assert.deepEqual(duplicate, []);
});

test("bulk site import resolves repeated and different driver names in one query and keeps input order", async () => {
  const driverNames = [
    `Первый водитель bulk-импорта ${randomUUID()}`,
    `Второй водитель bulk-импорта ${randomUUID()}`,
  ];
  const drivers = await db
    .insert(appUsersTable)
    .values(
      driverNames.map((name) => ({
        clerkUserId: `test-driver-${randomUUID()}`,
        email: `test-driver-${randomUUID()}@example.test`,
        name,
        role: "driver" as const,
        isDriver: true,
      })),
    )
    .returning({ id: appUsersTable.id });
  createdUserIds.push(...drivers.map((driver) => driver.id));

  const siteNames = [
    `Первая строка с первым водителем ${randomUUID()}`,
    `Строка без водителя ${randomUUID()}`,
    `Строка со вторым водителем ${randomUUID()}`,
    `Вторая строка с первым водителем ${randomUUID()}`,
  ];
  const assignedDriverIds = [drivers[0].id, null, drivers[1].id, drivers[0].id];
  observedBulkLookupQueries = {
    clients: 0,
    tradeNames: 0,
    deliveryTypes: 0,
    sites: 0,
    users: 0,
    writes: 0,
  };
  try {
    const response = await fetch(`${baseUrl}/sites/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: siteNames.map((name, index) => ({
          name,
          address: "Тестовый адрес",
          branch: "Тестовый куст",
          clientId,
          manager: "Тестовый менеджер",
          director: "Тестовый руководитель",
          project: "Тестовый проект",
          ...(assignedDriverIds[index]
            ? { driverUserId: assignedDriverIds[index] }
            : {}),
        })),
      }),
    });

    assert.equal(response.status, 201);
    const body = (await response.json()) as Array<{
      id: string;
      name: string;
      driverUserId: string | null;
      driver: string;
    }>;
    createdSiteIds.push(...body.map((site) => site.id));
    assert.equal(observedBulkLookupQueries.users, 1);
    assert.deepEqual(
      body.map(({ name, driverUserId, driver }) => ({
        name,
        driverUserId,
        driver,
      })),
      [
        { name: siteNames[0], driverUserId: drivers[0].id, driver: driverNames[0] },
        { name: siteNames[1], driverUserId: null, driver: "Не назначен" },
        { name: siteNames[2], driverUserId: drivers[1].id, driver: driverNames[1] },
        { name: siteNames[3], driverUserId: drivers[0].id, driver: driverNames[0] },
      ],
    );
  } finally {
    observedBulkLookupQueries = undefined;
  }
});

test("bulk site import rejects a non-driver from the same lookup and rolls back writes", async () => {
  const [nonDriver] = await db
    .insert(appUsersTable)
    .values({
      clerkUserId: `test-user-${randomUUID()}`,
      email: `test-user-${randomUUID()}@example.test`,
      name: "Пользователь без роли водителя",
      role: "manager",
      isDriver: false,
    })
    .returning({ id: appUsersTable.id });
  createdUserIds.push(nonDriver.id);
  const siteNames = [
    `Допустимая строка перед пользователем не-водителем ${randomUUID()}`,
    `Строка с пользователем не-водителем ${randomUUID()}`,
  ];
  observedBulkLookupQueries = {
    clients: 0,
    tradeNames: 0,
    deliveryTypes: 0,
    sites: 0,
    users: 0,
    writes: 0,
  };
  try {
    beginBulkImportLogCapture();
    const response = await fetch(`${baseUrl}/sites/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          bulkSiteItem(siteNames[0]),
          bulkSiteItem(siteNames[1], { driverUserId: nonDriver.id }),
        ],
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Один или несколько пользователей не являются водителями",
    });
    assertBulkImportLog({
      rowCount: siteNames.length,
      succeeded: 0,
    });
    assert.equal(observedBulkLookupQueries.users, 1);
    const persistedSites = await db
      .select({ name: sitesTable.name })
      .from(sitesTable)
      .where(inArray(sitesTable.name, siteNames));
    assert.deepEqual(persistedSites, []);
  } finally {
    observedBulkLookupQueries = undefined;
    await db.delete(sitesTable).where(inArray(sitesTable.name, siteNames));
  }
});

test("bulk site import returns 400 and rolls back all writes when its driver is deleted concurrently", async () => {
  const [driver] = await db
    .insert(appUsersTable)
    .values({
      clerkUserId: `test-driver-${randomUUID()}`,
      email: `test-driver-${randomUUID()}@example.test`,
      name: "Удаляемый во время bulk-импорта водитель",
      role: "driver",
      isDriver: true,
    })
    .returning({ id: appUsersTable.id });
  createdUserIds.push(driver.id);

  const existingSiteName = `Обновляемый объект гонки водителя ${randomUUID()}`;
  const [existingSite] = await db
    .insert(sitesTable)
    .values({
      name: existingSiteName,
      address: "Адрес до неудачного импорта",
      branch: "Куст до неудачного импорта",
      client: initialClientName,
      clientId,
      manager: "Менеджер до неудачного импорта",
      director: "Руководитель до неудачного импорта",
      project: "Проект до неудачного импорта",
    })
    .returning({ id: sitesTable.id });
  createdSiteIds.push(existingSite.id);

  const insertedSiteName = `Вставляемый объект гонки водителя ${randomUUID()}`;
  const fillerSiteNames = Array.from(
    { length: 98 },
    (_, index) => `Промежуточный объект гонки водителя ${index} ${randomUUID()}`,
  );
  const invalidDriverSiteName = `Объект удалённого водителя ${randomUUID()}`;
  const importedSiteNames = [
    existingSiteName,
    insertedSiteName,
    ...fillerSiteNames,
    invalidDriverSiteName,
  ];
  const items = importedSiteNames.map((name, index) => ({
    name,
    address: `Адрес импорта ${index}`,
    branch: "Куст импорта",
    clientId,
    manager: "Менеджер импорта",
    director: "Руководитель импорта",
    project: "Проект импорта",
    ...(name === invalidDriverSiteName ? { driverUserId: driver.id } : {}),
  }));

  const blocker = await pool.connect();
  let barrierReleased = false;
  let importRequest: Promise<Response> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE clients IN ACCESS EXCLUSIVE MODE");

    importRequest = fetch(`${baseUrl}/sites/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });
    await waitForBlockedTableLock(
      blocker.query.bind(blocker),
      "clients",
    );

    const deletedDrivers = await db
      .delete(appUsersTable)
      .where(eq(appUsersTable.id, driver.id))
      .returning({ id: appUsersTable.id });
    assert.deepEqual(deletedDrivers, [{ id: driver.id }]);

    await blocker.query("COMMIT");
    barrierReleased = true;

    const response = await importRequest;
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Один или несколько пользователей не являются водителями",
    });

    const persistedImportedSites = await db
      .select({
        name: sitesTable.name,
        address: sitesTable.address,
      })
      .from(sitesTable)
      .where(inArray(sitesTable.name, importedSiteNames));
    assert.deepEqual(persistedImportedSites, [{
      name: existingSiteName,
      address: "Адрес до неудачного импорта",
    }]);
  } finally {
    if (!barrierReleased) {
      await blocker.query("ROLLBACK").catch(() => undefined);
    }
    await Promise.allSettled(
      [importRequest].filter(
        (request): request is Promise<Response> => request !== undefined,
      ),
    );
    blocker.release();
    await db
      .delete(sitesTable)
      .where(inArray(sitesTable.name, importedSiteNames));
    await db.delete(appUsersTable).where(eq(appUsersTable.id, driver.id));
  }
});

test("bulk site import keeps input order with a repeated client and mixed inserts and updates", async () => {
  const existingSiteName = `Обновляемый объект bulk-импорта ${randomUUID()}`;
  const newSiteName = `Новый объект bulk-импорта ${randomUUID()}`;
  const [existingSite] = await db
    .insert(sitesTable)
    .values({
      name: existingSiteName,
      address: "Старый адрес",
      branch: "Старый куст",
      client: initialClientName,
      clientId,
      manager: "Старый менеджер",
      director: "Старый руководитель",
      project: "Старый проект",
    })
    .returning({ id: sitesTable.id });
  createdSiteIds.push(existingSite.id);

  const items = [
    {
      name: newSiteName,
      address: "Адрес нового объекта",
      branch: "Куст нового объекта",
      clientId: clientId.toUpperCase(),
      manager: "Менеджер нового объекта",
      director: "Руководитель нового объекта",
      project: "Проект нового объекта",
    },
    {
      name: existingSiteName,
      address: "Обновлённый адрес",
      branch: "Обновлённый куст",
      clientId,
      manager: "Обновлённый менеджер",
      director: "Обновлённый руководитель",
      project: "Обновлённый проект",
    },
  ];
  beginBulkImportLogCapture();
  const response = await fetch(`${baseUrl}/sites/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });

  assert.equal(response.status, 201);
  assertBulkImportLog({
    rowCount: items.length,
    writeBatchCount: 1,
    succeeded: 1,
  });
  const body = (await response.json()) as Array<{
    id: string;
    name: string;
    address: string;
    clientId: string;
  }>;
  createdSiteIds.push(
    ...body
      .filter((site) => site.id !== existingSite.id)
      .map((site) => site.id),
  );
  assert.deepEqual(
    body.map(({ id, name, address, clientId: responseClientId }) => ({
      id,
      name,
      address,
      clientId: responseClientId,
    })),
    [
      {
        id: body[0]?.id,
        name: newSiteName,
        address: items[0].address,
        clientId,
      },
      {
        id: existingSite.id,
        name: existingSiteName,
        address: items[1].address,
        clientId,
      },
    ],
  );
});

test("bulk site import resolves reference data and writes rows in bounded batches", async () => {
  const lookupCount = 101;
  const lookupSuffix = randomUUID();
  const additionalClients = await db
    .insert(clientsTable)
    .values(
      Array.from({ length: lookupCount - 1 }, (_, index) => ({
        name: `Клиент пакетной проверки ${index} ${lookupSuffix}`,
      })),
    )
    .returning({ id: clientsTable.id, name: clientsTable.name });
  createdClientIds.push(...additionalClients.map((client) => client.id));
  const clientIds = [clientId, ...additionalClients.map((client) => client.id)];
  const clientNames = [
    initialClientName,
    ...additionalClients.map((client) => client.name),
  ];
  const tradeNames = Array.from(
    { length: lookupCount },
    (_, index) => `Торговое название пакетной проверки ${index} ${lookupSuffix}`,
  );
  const deliveryTypes = Array.from(
    { length: lookupCount },
    (_, index) => `Тип поставки пакетной проверки ${index} ${lookupSuffix}`,
  );
  await db.insert(tradeNamesTable).values(tradeNames.map((name) => ({ name })));
  await db
    .insert(deliveryTypesTable)
    .values(deliveryTypes.map((name) => ({ name })));

  const existingSiteNames = [
    `Первый существующий объект пакетной проверки ${randomUUID()}`,
    `Второй существующий объект пакетной проверки ${randomUUID()}`,
  ];
  const existingSites = await db
    .insert(sitesTable)
    .values(
      existingSiteNames.map((name, index) => ({
        name,
        address: "Старый адрес",
        branch: "Старый куст",
        client: clientNames[index],
        clientId: clientIds[index],
        manager: "Старый менеджер",
        director: "Старый руководитель",
        project: "Старый проект",
      })),
    )
    .returning({ id: sitesTable.id });
  createdSiteIds.push(...existingSites.map((site) => site.id));

  const newSiteNames = Array.from(
    { length: lookupCount },
    (_, index) => `Новый объект пакетной проверки ${index} ${randomUUID()}`,
  );
  const items = [
    { name: existingSiteNames[0], clientId: clientIds[0] },
    { name: newSiteNames[0], clientId: clientIds[1].toUpperCase() },
    { name: existingSiteNames[1], clientId: clientIds[2] },
    { name: newSiteNames[1], clientId: clientIds[3].toUpperCase() },
    ...newSiteNames.slice(2).map((name, index) => ({
      name,
      clientId: clientIds[(index + 4) % lookupCount],
    })),
  ].map((item, index) => ({
    ...item,
    customer: tradeNames[index % lookupCount],
    deliveryType: deliveryTypes[index % lookupCount],
    address: `Новый адрес ${item.name}`,
    branch: "Новый куст",
    manager: "Новый менеджер",
    director: "Новый руководитель",
    project: "Новый проект",
  }));
  items[100] = {
    ...items[100],
    name: newSiteNames[0],
    address: "Адрес повторной строки через границу пакета",
  };

  observedBulkLookupQueries = {
    clients: 0,
    tradeNames: 0,
    deliveryTypes: 0,
    sites: 0,
    users: 0,
    writes: 0,
  };
  try {
    const response = await fetch(`${baseUrl}/sites/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as Array<{
      id: string;
      name: string;
      address: string;
    }>;
    createdSiteIds.push(
      ...body
        .filter((site) => newSiteNames.includes(site.name))
        .map((site) => site.id),
    );
    assert.deepEqual(observedBulkLookupQueries, {
      clients: 2,
      tradeNames: 2,
      deliveryTypes: 2,
      sites: 0,
      users: 0,
      writes: 2,
    });
    assert.equal(body[1]?.name, newSiteNames[0]);
    assert.equal(body[100]?.name, newSiteNames[0]);
    assert.equal(body[1]?.id, body[100]?.id);
    assert.equal(body[1]?.address, items[1]?.address);
    assert.equal(body[100]?.address, items[100]?.address);

    const [persistedRepeatedSite] = await db
      .select({ address: sitesTable.address })
      .from(sitesTable)
      .where(eq(sitesTable.name, newSiteNames[0]));
    assert.equal(persistedRepeatedSite?.address, items[100]?.address);
  } finally {
    observedBulkLookupQueries = undefined;
    await db
      .delete(tradeNamesTable)
      .where(inArray(tradeNamesTable.name, tradeNames));
    await db
      .delete(deliveryTypesTable)
      .where(inArray(deliveryTypesTable.name, deliveryTypes));
  }
});

test("bulk site import rolls back an earlier insert when a later database write fails", async () => {
  const firstSiteName = `Первая строка для отката ${randomUUID()}`;
  const fillerSiteNames = Array.from(
    { length: 99 },
    (_, index) => `Промежуточная строка для отката ${index} ${randomUUID()}`,
  );
  const failingSiteName = `Строка второго пакета со сбоем ${randomUUID()}`;
  const importedSiteNames = [
    firstSiteName,
    ...fillerSiteNames,
    failingSiteName,
  ];
  const constraintName = "sites_bulk_rollback_integration_ck";
  const quotedNameResult = await pool.query<{ quoted: string }>(
    "SELECT quote_literal($1) AS quoted",
    [failingSiteName],
  );
  const quotedFailingName = quotedNameResult.rows[0]?.quoted;
  assert.ok(quotedFailingName);

  await pool.query(
    `ALTER TABLE sites DROP CONSTRAINT IF EXISTS ${constraintName}`,
  );
  await pool.query(
    `ALTER TABLE sites ADD CONSTRAINT ${constraintName} CHECK (name <> ${quotedFailingName})`,
  );

  try {
    beginBulkImportLogCapture();
    const response = await fetch(`${baseUrl}/sites/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: importedSiteNames.map((name) => ({
          name,
          address: "Тестовый адрес",
          branch: "Тестовый куст",
          clientId,
          manager: "Тестовый менеджер",
          director: "Тестовый руководитель",
          project: "Тестовый проект",
        })),
      }),
    });
    assert.equal(response.status, 500);
    assertBulkImportLog({
      rowCount: importedSiteNames.length,
      writeBatchCount: 2,
      succeeded: 0,
    });

    const persistedSites = await db
      .select({ name: sitesTable.name })
      .from(sitesTable)
      .where(inArray(sitesTable.name, importedSiteNames));
    assert.deepEqual(persistedSites, []);
  } finally {
    await pool.query(
      `ALTER TABLE sites DROP CONSTRAINT IF EXISTS ${constraintName}`,
    );
    await db
      .delete(sitesTable)
      .where(inArray(sitesTable.name, importedSiteNames));
  }
});

test("bulk site import rolls back writes when response preparation fails", async () => {
  const siteName = `Объект со сбоем подготовки ответа ${randomUUID()}`;
  const triggerName = "sites_bulk_response_failure_integration_trg";
  const functionName = "sites_bulk_response_failure_integration_fn";
  const [driver] = await db
    .insert(appUsersTable)
    .values({
      clerkUserId: `test-driver-${randomUUID()}`,
      email: `test-driver-${randomUUID()}@example.test`,
      name: "Тестовый водитель",
      role: "driver",
      isDriver: true,
    })
    .returning({ id: appUsersTable.id });
  createdUserIds.push(driver.id);

  const quotedNameResult = await pool.query<{ quoted: string }>(
    "SELECT quote_literal($1) AS quoted",
    [siteName],
  );
  const quotedSiteName = quotedNameResult.rows[0]?.quoted;
  assert.ok(quotedSiteName);

  await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON sites`);
  await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
  await pool.query(`
    CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
    BEGIN
      IF NEW.name = ${quotedSiteName} THEN
        PERFORM pg_advisory_xact_lock(173173);
        PERFORM pg_sleep(3);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await pool.query(`
    CREATE TRIGGER ${triggerName}
    BEFORE INSERT ON sites
    FOR EACH ROW EXECUTE FUNCTION ${functionName}()
  `);

  const lockClient = await pool.connect();
  try {
    const responsePromise = fetch(`${baseUrl}/sites/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            name: siteName,
            address: "Тестовый адрес",
            branch: "Тестовый куст",
            clientId,
            manager: "Тестовый менеджер",
            director: "Тестовый руководитель",
            project: "Тестовый проект",
            driverUserId: driver.id,
          },
        ],
      }),
    });

    let routePid: number | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const active = await pool.query<{ pid: number }>(`
        SELECT pid
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND classid = 0
          AND objid = 173173
          AND granted = true
        LIMIT 1
      `);
      routePid = active.rows[0]?.pid;
      if (routePid !== undefined) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(routePid, "bulk route did not reach the response-failure fixture");

    await lockClient.query("BEGIN");
    await lockClient.query("LOCK TABLE app_users IN ACCESS EXCLUSIVE MODE");

    let responseQueryBlocked = false;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const active = await pool.query<{ blocked: boolean }>(
        `
          SELECT wait_event_type = 'Lock' AS blocked
          FROM pg_stat_activity
          WHERE pid = $1
        `,
        [routePid],
      );
      responseQueryBlocked = active.rows[0]?.blocked ?? false;
      if (responseQueryBlocked) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(
      responseQueryBlocked,
      true,
      "driver lookup did not run inside the bulk transaction",
    );

    const cancelled = await pool.query<{ cancelled: boolean }>(
      "SELECT pg_cancel_backend($1) AS cancelled",
      [routePid],
    );
    assert.equal(cancelled.rows[0]?.cancelled, true);

    const response = await responsePromise;
    assert.equal(response.status, 500);
    const [persistedSite] = await db
      .select({ id: sitesTable.id })
      .from(sitesTable)
      .where(eq(sitesTable.name, siteName));
    assert.equal(persistedSite, undefined);
  } finally {
    await lockClient.query("ROLLBACK").catch(() => undefined);
    lockClient.release();
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON sites`);
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await db.delete(sitesTable).where(eq(sitesTable.name, siteName));
  }
});

test("bulk site import restores an updated site when response preparation fails", async () => {
  const existingSiteName = `Объект с откатом обновления ответа ${randomUUID()}`;
  const triggerName = "sites_bulk_update_response_failure_integration_trg";
  const functionName = "sites_bulk_update_response_failure_integration_fn";
  const [driver] = await db
    .insert(appUsersTable)
    .values({
      clerkUserId: `test-driver-${randomUUID()}`,
      email: `test-driver-${randomUUID()}@example.test`,
      name: "Водитель обновляемого объекта",
      role: "driver",
      isDriver: true,
    })
    .returning({ id: appUsersTable.id });
  createdUserIds.push(driver.id);

  const oldValues = {
    address: "Старый адрес перед сбоем ответа",
    branch: "Старый куст перед сбоем ответа",
    customer: "",
    manager: "Старый менеджер перед сбоем ответа",
    managerContact: "Старый контакт перед сбоем ответа",
    director: "Старый руководитель перед сбоем ответа",
    project: "Старый проект перед сбоем ответа",
    driverUserId: driver.id,
    deliveryType: "",
  };
  const [existingSite] = await db
    .insert(sitesTable)
    .values({
      name: existingSiteName,
      ...oldValues,
      client: initialClientName,
      clientId,
    })
    .returning({ id: sitesTable.id, client: sitesTable.client });
  createdSiteIds.push(existingSite.id);

  const quotedNameResult = await pool.query<{ quoted: string }>(
    "SELECT quote_literal($1) AS quoted",
    [existingSiteName],
  );
  const quotedSiteName = quotedNameResult.rows[0]?.quoted;
  assert.ok(quotedSiteName);

  await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON sites`);
  await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
  await pool.query(`
    CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
    BEGIN
      IF NEW.name = ${quotedSiteName} THEN
        PERFORM pg_advisory_xact_lock(174174);
        PERFORM pg_sleep(3);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await pool.query(`
    CREATE TRIGGER ${triggerName}
    AFTER UPDATE ON sites
    FOR EACH ROW EXECUTE FUNCTION ${functionName}()
  `);

  const lockClient = await pool.connect();
  try {
    const responsePromise = fetch(`${baseUrl}/sites/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            name: existingSiteName,
            address: "Новый адрес после импорта",
            branch: "Новый куст после импорта",
            clientId,
            manager: "Новый менеджер после импорта",
            managerContact: "Новый контакт после импорта",
            director: "Новый руководитель после импорта",
            project: "Новый проект после импорта",
            driverUserId: driver.id,
          },
        ],
      }),
    });

    let routePid: number | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const active = await pool.query<{ pid: number }>(`
        SELECT pid
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND classid = 0
          AND objid = 174174
          AND granted = true
        LIMIT 1
      `);
      routePid = active.rows[0]?.pid;
      if (routePid !== undefined) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(routePid, "bulk route did not update the existing site");

    await lockClient.query("BEGIN");
    await lockClient.query("LOCK TABLE app_users IN ACCESS EXCLUSIVE MODE");

    let responseQueryBlocked = false;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const active = await pool.query<{ blocked: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM pg_locks AS lock
            JOIN pg_class AS relation ON relation.oid = lock.relation
            WHERE lock.pid = $1
              AND relation.relname = 'app_users'
              AND lock.mode = 'AccessShareLock'
              AND lock.granted = false
          ) AS blocked
        `,
        [routePid],
      );
      responseQueryBlocked = active.rows[0]?.blocked ?? false;
      if (responseQueryBlocked) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(
      responseQueryBlocked,
      true,
      "driver lookup did not run after the existing site update",
    );

    const cancelled = await pool.query<{ cancelled: boolean }>(
      "SELECT pg_cancel_backend($1) AS cancelled",
      [routePid],
    );
    assert.equal(cancelled.rows[0]?.cancelled, true);

    const response = await responsePromise;
    assert.equal(response.status, 500);

    const [persistedSite] = await db
      .select({
        name: sitesTable.name,
        address: sitesTable.address,
        branch: sitesTable.branch,
        customer: sitesTable.customer,
        client: sitesTable.client,
        clientId: sitesTable.clientId,
        manager: sitesTable.manager,
        managerContact: sitesTable.managerContact,
        director: sitesTable.director,
        project: sitesTable.project,
        driverUserId: sitesTable.driverUserId,
        deliveryType: sitesTable.deliveryType,
      })
      .from(sitesTable)
      .where(eq(sitesTable.id, existingSite.id));
    assert.deepEqual(persistedSite, {
      name: existingSiteName,
      ...oldValues,
      client: existingSite.client,
      clientId,
    });
  } finally {
    await lockClient.query("ROLLBACK").catch(() => undefined);
    lockClient.release();
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON sites`);
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
  }
});

test("bulk site import rolls back an earlier update when a later database write fails", async () => {
  const existingSiteName = `Существующий объект для отката ${randomUUID()}`;
  const fillerSiteNames = Array.from(
    { length: 99 },
    (_, index) => `Промежуточная строка после обновления ${index} ${randomUUID()}`,
  );
  const failingSiteName = `Строка второго пакета после обновления ${randomUUID()}`;
  const constraintName = "sites_bulk_update_rollback_integration_ck";
  const oldValues = {
    address: "Старый адрес",
    branch: "Старый куст",
    customer: "",
    manager: "Старый менеджер",
    managerContact: "Старый контакт",
    director: "Старый руководитель",
    project: "Старый проект",
    driverUserId: null,
    deliveryType: "",
  };
  const [existingSite] = await db
    .insert(sitesTable)
    .values({
      name: existingSiteName,
      ...oldValues,
      client: initialClientName,
      clientId,
    })
    .returning({ id: sitesTable.id, client: sitesTable.client });
  createdSiteIds.push(existingSite.id);

  const [client] = await db
    .select({ name: clientsTable.name })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  assert.ok(client);

  const quotedNameResult = await pool.query<{ quoted: string }>(
    "SELECT quote_literal($1) AS quoted",
    [failingSiteName],
  );
  const quotedFailingName = quotedNameResult.rows[0]?.quoted;
  assert.ok(quotedFailingName);

  await pool.query(
    `ALTER TABLE sites DROP CONSTRAINT IF EXISTS ${constraintName}`,
  );
  await pool.query(
    `ALTER TABLE sites ADD CONSTRAINT ${constraintName} CHECK (name <> ${quotedFailingName})`,
  );

  try {
    const response = await fetch(`${baseUrl}/sites/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            name: existingSiteName,
            address: "Новый адрес",
            branch: "Новый куст",
            clientId,
            manager: "Новый менеджер",
            managerContact: "Новый контакт",
            director: "Новый руководитель",
            project: "Новый проект",
          },
          ...fillerSiteNames.map((name) => ({
            name,
            address: "Промежуточный адрес",
            branch: "Промежуточный куст",
            clientId,
            manager: "Промежуточный менеджер",
            director: "Промежуточный руководитель",
            project: "Промежуточный проект",
          })),
          {
            name: failingSiteName,
            address: "Тестовый адрес",
            branch: "Тестовый куст",
            clientId,
            manager: "Тестовый менеджер",
            director: "Тестовый руководитель",
            project: "Тестовый проект",
          },
        ],
      }),
    });
    assert.equal(response.status, 500);

    const [persistedSite] = await db
      .select({
        name: sitesTable.name,
        address: sitesTable.address,
        branch: sitesTable.branch,
        customer: sitesTable.customer,
        client: sitesTable.client,
        clientId: sitesTable.clientId,
        manager: sitesTable.manager,
        managerContact: sitesTable.managerContact,
        director: sitesTable.director,
        project: sitesTable.project,
        driverUserId: sitesTable.driverUserId,
        deliveryType: sitesTable.deliveryType,
      })
      .from(sitesTable)
      .where(eq(sitesTable.id, existingSite.id));
    assert.deepEqual(persistedSite, {
      name: existingSiteName,
      ...oldValues,
      client: existingSite.client,
      clientId,
    });

    const [partiallyCreated] = await db
      .select({ id: sitesTable.id })
      .from(sitesTable)
      .where(inArray(sitesTable.name, [...fillerSiteNames, failingSiteName]));
    assert.equal(partiallyCreated, undefined);
  } finally {
    await pool.query(
      `ALTER TABLE sites DROP CONSTRAINT IF EXISTS ${constraintName}`,
    );
    await db
      .delete(sitesTable)
      .where(inArray(sitesTable.name, [...fillerSiteNames, failingSiteName]));
  }
});

test("bulk site import rolls back an earlier insert when a later update fails", async () => {
  const newSiteName = `Новый объект перед сбоем обновления ${randomUUID()}`;
  const existingSiteName = `Существующий объект со сбоем обновления ${randomUUID()}`;
  const updatedAddress = `Запрещённый новый адрес ${randomUUID()}`;
  const constraintName = "sites_bulk_insert_update_rollback_integration_ck";
  const oldValues = {
    address: "Старый адрес",
    branch: "Старый куст",
    customer: "",
    manager: "Старый менеджер",
    managerContact: "Старый контакт",
    director: "Старый руководитель",
    project: "Старый проект",
    driverUserId: null,
    deliveryType: "",
  };
  const [existingSite] = await db
    .insert(sitesTable)
    .values({
      name: existingSiteName,
      ...oldValues,
      client: initialClientName,
      clientId,
    })
    .returning({ id: sitesTable.id, client: sitesTable.client });
  createdSiteIds.push(existingSite.id);

  const quotedNameResult = await pool.query<{ quoted: string }>(
    "SELECT quote_literal($1) AS quoted",
    [existingSiteName],
  );
  const quotedAddressResult = await pool.query<{ quoted: string }>(
    "SELECT quote_literal($1) AS quoted",
    [updatedAddress],
  );
  const quotedExistingName = quotedNameResult.rows[0]?.quoted;
  const quotedUpdatedAddress = quotedAddressResult.rows[0]?.quoted;
  assert.ok(quotedExistingName);
  assert.ok(quotedUpdatedAddress);

  await pool.query(
    `ALTER TABLE sites DROP CONSTRAINT IF EXISTS ${constraintName}`,
  );
  await pool.query(
    `ALTER TABLE sites ADD CONSTRAINT ${constraintName} CHECK (name <> ${quotedExistingName} OR address <> ${quotedUpdatedAddress})`,
  );

  try {
    const response = await fetch(`${baseUrl}/sites/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            name: newSiteName,
            address: "Адрес нового объекта",
            branch: "Куст нового объекта",
            clientId,
            manager: "Менеджер нового объекта",
            director: "Руководитель нового объекта",
            project: "Проект нового объекта",
          },
          {
            name: existingSiteName,
            address: updatedAddress,
            branch: "Новый куст",
            clientId,
            manager: "Новый менеджер",
            managerContact: "Новый контакт",
            director: "Новый руководитель",
            project: "Новый проект",
          },
        ],
      }),
    });
    assert.equal(response.status, 500);

    const [partiallyCreated] = await db
      .select({ id: sitesTable.id })
      .from(sitesTable)
      .where(eq(sitesTable.name, newSiteName));
    assert.equal(partiallyCreated, undefined);

    const [persistedSite] = await db
      .select({
        name: sitesTable.name,
        address: sitesTable.address,
        branch: sitesTable.branch,
        customer: sitesTable.customer,
        client: sitesTable.client,
        clientId: sitesTable.clientId,
        manager: sitesTable.manager,
        managerContact: sitesTable.managerContact,
        director: sitesTable.director,
        project: sitesTable.project,
        driverUserId: sitesTable.driverUserId,
        deliveryType: sitesTable.deliveryType,
      })
      .from(sitesTable)
      .where(eq(sitesTable.id, existingSite.id));
    assert.deepEqual(persistedSite, {
      name: existingSiteName,
      ...oldValues,
      client: existingSite.client,
      clientId,
    });
  } finally {
    await pool.query(
      `ALTER TABLE sites DROP CONSTRAINT IF EXISTS ${constraintName}`,
    );
    await db.delete(sitesTable).where(eq(sitesTable.name, newSiteName));
  }
});

test("creating a client rejects names differing only by case and outer spaces", async () => {
  const name = `Уникальный клиент ${randomUUID()}`;
  const submittedName = `\u00A0Уникальный\t\tклиент\u2009${name.split(" ").at(-1)}\u3000`;
  const createdResponse = await fetch(`${baseUrl}/clients`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: submittedName }),
  });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()) as {
    id: string;
    name: string;
  };
  createdClientIds.push(created.id);
  assert.equal(created.name, name);

  const conflictResponse = await fetch(`${baseUrl}/clients`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `\u2028${name
        .toLocaleUpperCase("ru-RU")
        .replaceAll(" ", "\u2003\u205F")}\uFEFF`,
    }),
  });
  assert.equal(conflictResponse.status, 409);
  assert.deepEqual(await conflictResponse.json(), {
    error: "Клиент с таким названием уже существует",
  });
});

test("creating a client rejects a normalized name matching historical Unicode whitespace", async () => {
  const suffix = randomUUID();
  const historicalName = `Исторический\u00A0клиент  ${suffix}`;
  const [historicalClient] = await db
    .insert(clientsTable)
    .values({ name: historicalName })
    .returning({ id: clientsTable.id });
  createdClientIds.push(historicalClient.id);

  const response = await fetch(`${baseUrl}/clients`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `Исторический клиент ${suffix}` }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Клиент с таким названием уже существует",
  });
});

test("creating a client rejects names hidden by zero-width formatting characters", async () => {
  for (const invisible of ["\u200B", "\u200C", "\u200D", "\u2060"]) {
    const suffix = randomUUID();
    const canonicalName = `Zerowidth клиент ${suffix}`;
    const [existingClient] = await db
      .insert(clientsTable)
      .values({ name: canonicalName })
      .returning({ id: clientsTable.id });
    createdClientIds.push(existingClient.id);

    const response = await fetch(`${baseUrl}/clients`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `Zero${invisible}width клиент ${suffix}`,
      }),
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "Клиент с таким названием уже существует",
    });
  }
});

test("rename rejects names hidden by zero-width formatting characters", async () => {
  for (const invisible of ["\u200B", "\u200C", "\u200D", "\u2060"]) {
    const suffix = randomUUID();
    const [firstClient, secondClient] = await db
      .insert(clientsTable)
      .values([
        { name: `Первый zerowidth клиент ${suffix}` },
        { name: `Второй zerowidth клиент ${suffix}` },
      ])
      .returning({ id: clientsTable.id });
    createdClientIds.push(firstClient.id, secondClient.id);

    const response = await fetch(`${baseUrl}/clients/${secondClient.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `Первый ${invisible}zerowidth клиент ${suffix}`,
      }),
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "Клиент с таким названием уже существует",
    });
  }
});

test("client unique index rejects direct inserts hidden by zero-width formatting characters", async () => {
  for (const invisible of ["\u200B", "\u200C", "\u200D", "\u2060"]) {
    const suffix = randomUUID();
    const [existingClient] = await db
      .insert(clientsTable)
      .values({ name: `Индекс zerowidth клиент ${suffix}` })
      .returning({ id: clientsTable.id });
    createdClientIds.push(existingClient.id);

    await assert.rejects(
      db.insert(clientsTable).values({
        name: `Индекс ${invisible}zerowidth клиент ${suffix}`,
      }),
      (error: unknown) => {
        assert.ok(
          [
            "clients_name_unicode_normalized_uq",
            "clients_name_invisible_normalized_uq",
          ].includes(findPostgresConstraint(error) ?? ""),
        );
        return true;
      },
    );
  }
});

test("site POST, PATCH and bulk preserve an exact historical client name", async () => {
  const historicalName = `  Исторический\u00A0клиент  ${randomUUID()}  `;
  const [historicalClient] = await db
    .insert(clientsTable)
    .values({ name: historicalName })
    .returning({ id: clientsTable.id });
  createdClientIds.push(historicalClient.id);

  const postResponse = await fetch(`${baseUrl}/sites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `POST объект исторического клиента ${randomUUID()}`,
      address: "Тестовый адрес",
      branch: "Тестовый куст",
      customer: siteTradeName,
      clientId: historicalClient.id,
      manager: "Тестовый менеджер",
      director: "Тестовый руководитель",
      project: "Тестовый проект",
    }),
  });
  assert.equal(postResponse.status, 201);
  const postSite = (await postResponse.json()) as { id: string };
  createdSiteIds.push(postSite.id);

  const bulkResponse = await fetch(`${baseUrl}/sites/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [
        {
          name: `Bulk объект исторического клиента ${randomUUID()}`,
          address: "Тестовый адрес",
          branch: "Тестовый куст",
          clientId: historicalClient.id,
          manager: "Тестовый менеджер",
          director: "Тестовый руководитель",
          project: "Тестовый проект",
        },
      ],
    }),
  });
  assert.equal(bulkResponse.status, 201);
  const [bulkSite] = (await bulkResponse.json()) as Array<{ id: string }>;
  createdSiteIds.push(bulkSite.id);

  const [patchTarget] = await db
    .insert(sitesTable)
    .values({
      name: `PATCH объект исторического клиента ${randomUUID()}`,
      address: "Тестовый адрес",
      branch: "Тестовый куст",
      client: initialClientName,
      clientId,
      manager: "Тестовый менеджер",
      director: "Тестовый руководитель",
      project: "Тестовый проект",
    })
    .returning({ id: sitesTable.id });
  createdSiteIds.push(patchTarget.id);
  const patchResponse = await fetch(`${baseUrl}/sites/${patchTarget.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId: historicalClient.id }),
  });
  assert.equal(patchResponse.status, 200);

  const storedSites = await db
    .select({ id: sitesTable.id, client: sitesTable.client })
    .from(sitesTable)
    .where(inArray(sitesTable.id, [postSite.id, bulkSite.id, patchTarget.id]));
  assert.equal(storedSites.length, 3);
  assert.equal(
    storedSites.every((site) => site.client === historicalName),
    true,
  );
});

test("rename rejects a name equal after mixed Unicode whitespace normalization", async () => {
  const firstName = `Первый Unicode клиент ${randomUUID()}`;
  const secondName = `Второй Unicode клиент ${randomUUID()}`;
  const [firstClient, secondClient] = await db
    .insert(clientsTable)
    .values([{ name: firstName }, { name: secondName }])
    .returning({ id: clientsTable.id });
  createdClientIds.push(firstClient.id, secondClient.id);

  const response = await fetch(`${baseUrl}/clients/${secondClient.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `\u1680${firstName
        .toLocaleUpperCase("ru-RU")
        .replaceAll(" ", "\t\u00A0\u200A")}\u3000`,
    }),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Клиент с таким названием уже существует",
  });
});

test("site writes derive display name from clientId while search uses PostgreSQL case folding", async () => {
  const clientName = `İstanbul клиент ${randomUUID()}`;
  const submittedName = clientName.replace("İ", "i");
  const [client] = await db
    .insert(clientsTable)
    .values({ name: clientName })
    .returning({ id: clientsTable.id });
  createdClientIds.push(client.id);

  const createResponse = await fetch(`${baseUrl}/sites/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [
        {
          name: `Объект PostgreSQL case fold ${randomUUID()}`,
          address: "Тестовый адрес",
          branch: "Тестовый куст",
          clientId: client.id,
          manager: "Тестовый менеджер",
          director: "Тестовый руководитель",
          project: "Тестовый проект",
        },
      ],
    }),
  });
  assert.equal(createResponse.status, 201);
  const [createdSite] = (await createResponse.json()) as Array<{ id: string }>;
  createdSiteIds.push(createdSite.id);

  const updateResponse = await fetch(`${baseUrl}/sites/${createdSite.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId: client.id }),
  });
  assert.equal(updateResponse.status, 200);

  const searchResponse = await fetch(
    `${baseUrl}/clients?search=${encodeURIComponent(submittedName)}`,
  );
  assert.equal(searchResponse.status, 200);
  const searchResults = (await searchResponse.json()) as Array<{ id: string }>;
  assert.equal(
    searchResults.some((result) => result.id === client.id),
    true,
  );
});

test("client list and delete count a linked site by stable id", async () => {
  const clientName = `Клиент объекта ${randomUUID()}`;
  const linkedSiteName = `Связанный объект ${randomUUID()}`;
  const [client] = await db
    .insert(clientsTable)
    .values({ name: clientName })
    .returning({ id: clientsTable.id });
  createdClientIds.push(client.id);
  const [site] = await db
    .insert(sitesTable)
    .values({
      name: linkedSiteName,
      address: "Тестовый адрес",
      branch: "Тестовый куст",
      client: clientName,
      clientId: client.id,
      manager: "Тестовый менеджер",
      director: "Тестовый руководитель",
      project: "Тестовый проект",
    })
    .returning({ id: sitesTable.id });
  createdSiteIds.push(site.id);

  const listResponse = await fetch(`${baseUrl}/clients`);
  assert.equal(listResponse.status, 200);
  const listedClients = (await listResponse.json()) as Array<{
    id: string;
    name: string;
    siteCount: number;
  }>;
  const listedClient = listedClients.find(
    (candidate) => candidate.id === client.id,
  );
  assert.ok(listedClient);
  assert.equal(listedClient.name, clientName);
  assert.equal(listedClient.siteCount, 1);

  const deleteResponse = await fetch(`${baseUrl}/clients/${client.id}`, {
    method: "DELETE",
  });
  assert.equal(deleteResponse.status, 409);
  assert.deepEqual(await deleteResponse.json(), {
    error: "Нельзя удалить клиента, пока к нему привязаны объекты",
    code: "CLIENT_HAS_SITES",
    blockingSites: {
      count: 1,
      preview: [{ id: site.id, name: linkedSiteName }],
    },
  });
});

test("concurrent normalized client creates produce one row and one conflict", async () => {
  const name = `Конкурентный клиент ${randomUUID()}`;
  const responses = await Promise.all([
    fetch(`${baseUrl}/clients`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.replaceAll(" ", "\t\u2009") }),
    }),
    fetch(`${baseUrl}/clients`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `\u00A0${name
          .toLocaleUpperCase("ru-RU")
          .replaceAll(" ", "\u202F\u205F")}\u3000`,
      }),
    }),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [201, 409],
  );
  const createdResponse = responses.find((response) => response.status === 201);
  assert.ok(createdResponse);
  const created = (await createdResponse.json()) as { id: string };
  createdClientIds.push(created.id);
  const conflictResponse = responses.find(
    (response) => response.status === 409,
  );
  assert.ok(conflictResponse);
  assert.deepEqual(await conflictResponse.json(), {
    error: "Клиент с таким названием уже существует",
  });

  const matchingClients = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(
      sql`${canonicalClientNameSql(clientsTable.name)} = ${canonicalClientNameSql(name)}`,
    );
  assert.equal(matchingClients.length, 1);
});

test("site creation waits for client deletion and cannot preserve the deleted client name", async () => {
  const raceClientName = `Клиент гонки удаления ${randomUUID()}`;
  const raceSiteName = `Объект гонки удаления ${randomUUID()}`;
  const [raceClient] = await db
    .insert(clientsTable)
    .values({ name: raceClientName })
    .returning({ id: clientsTable.id });
  createdClientIds.push(raceClient.id);

  const blocker = await pool.connect();
  let barrierReleased = false;
  let deleteRequest: Promise<Response> | undefined;
  let createRequest: Promise<Response> | undefined;
  let createSettled = false;

  try {
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE orders IN ACCESS EXCLUSIVE MODE");

    deleteRequest = fetch(`${baseUrl}/clients/${raceClient.id}`, {
      method: "DELETE",
    });
    const deletePid = await waitForBlockedTableLock(
      blocker.query.bind(blocker),
      "orders",
    );
    const heldLocks = await blocker.query(
      `
        SELECT relation.relname
        FROM pg_locks AS lock
        JOIN pg_class AS relation ON relation.oid = lock.relation
        WHERE lock.pid = $1
          AND lock.mode = 'ShareRowExclusiveLock'
          AND lock.granted = true
          AND relation.relname IN ('clients', 'sites')
        ORDER BY relation.relname
      `,
      [deletePid],
    );
    assert.deepEqual(
      heldLocks.rows.map((row) => row.relname),
      ["clients", "sites"],
    );

    createRequest = fetch(`${baseUrl}/sites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: raceSiteName,
        address: "Тестовый адрес",
        branch: "Тестовый куст",
        customer: siteTradeName,
        client: raceClientName,
        clientId: raceClient.id,
        manager: "Тестовый менеджер",
        director: "Тестовый руководитель",
        project: "Тестовый проект",
      }),
    }).then((response) => {
      createSettled = true;
      return response;
    });
    await waitForBlockedTableLock(
      blocker.query.bind(blocker),
      "clients",
      deletePid,
    );
    assert.equal(createSettled, false);

    await blocker.query("COMMIT");
    barrierReleased = true;

    const [deleteResponse, createResponse] = await Promise.all([
      deleteRequest,
      createRequest,
    ]);
    assert.equal(deleteResponse.status, 204);
    assert.equal(createResponse.status, 400);
    assert.match(
      String(((await createResponse.json()) as { error?: string }).error),
      /не найден/,
    );

    const [remainingClient] = await db
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(eq(clientsTable.id, raceClient.id));
    assert.equal(remainingClient, undefined);

    const matchingSites = await db
      .select({ id: sitesTable.id })
      .from(sitesTable)
      .where(
        sql`${canonicalClientNameSql(sitesTable.client)} = ${canonicalClientNameSql(raceClientName)}`,
      );
    assert.deepEqual(matchingSites, []);
  } finally {
    if (!barrierReleased) {
      await blocker.query("ROLLBACK").catch(() => undefined);
    }
    await Promise.allSettled(
      [deleteRequest, createRequest].filter(
        (request): request is Promise<Response> => request !== undefined,
      ),
    );
    blocker.release();
    await db.delete(sitesTable).where(eq(sitesTable.name, raceSiteName));
    await db.delete(clientsTable).where(eq(clientsTable.id, raceClient.id));
  }
});

test("site update waits for target client deletion and cannot preserve the deleted client name", async () => {
  const raceClientName = `Целевой клиент гонки изменения ${randomUUID()}`;
  const originalAddress = `Адрес до гонки изменения клиента ${randomUUID()}`;
  const changedAddress = `Адрес после гонки изменения клиента ${randomUUID()}`;
  const [raceClient] = await db
    .insert(clientsTable)
    .values({ name: raceClientName })
    .returning({ id: clientsTable.id });
  createdClientIds.push(raceClient.id);
  const [raceSite] = await db
    .insert(sitesTable)
    .values({
      name: `Объект гонки изменения клиента ${randomUUID()}`,
      address: originalAddress,
      branch: "Тестовый куст",
      client: initialClientName,
      clientId,
      manager: "Тестовый менеджер",
      director: "Тестовый руководитель",
      project: "Тестовый проект",
    })
    .returning({ id: sitesTable.id });
  createdSiteIds.push(raceSite.id);

  const blocker = await pool.connect();
  let barrierReleased = false;
  let deleteRequest: Promise<Response> | undefined;
  let updateRequest: Promise<Response> | undefined;
  let updateSettled = false;

  try {
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE orders IN ACCESS EXCLUSIVE MODE");

    deleteRequest = fetch(`${baseUrl}/clients/${raceClient.id}`, {
      method: "DELETE",
    });
    const deletePid = await waitForBlockedTableLock(
      blocker.query.bind(blocker),
      "orders",
    );

    updateRequest = fetch(`${baseUrl}/sites/${raceSite.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: raceClient.id,
        address: changedAddress,
      }),
    }).then((response) => {
      updateSettled = true;
      return response;
    });
    await waitForBlockedTableLock(
      blocker.query.bind(blocker),
      "clients",
      deletePid,
    );
    assert.equal(updateSettled, false);

    await blocker.query("COMMIT");
    barrierReleased = true;

    const [deleteResponse, updateResponse] = await Promise.all([
      deleteRequest,
      updateRequest,
    ]);
    assert.equal(deleteResponse.status, 204);
    assert.equal(updateResponse.status, 400);
    assert.match(
      String(((await updateResponse.json()) as { error?: string }).error),
      /не найден/,
    );

    const [remainingClient] = await db
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(eq(clientsTable.id, raceClient.id));
    assert.equal(remainingClient, undefined);

    const [persistedSite] = await db
      .select({
        address: sitesTable.address,
        client: sitesTable.client,
        clientId: sitesTable.clientId,
      })
      .from(sitesTable)
      .where(eq(sitesTable.id, raceSite.id));
    assert.deepEqual(persistedSite, {
      address: originalAddress,
      client: initialClientName,
      clientId,
    });

    const sitesWithDeletedClientName = await db
      .select({ id: sitesTable.id })
      .from(sitesTable)
      .where(
        sql`${canonicalClientNameSql(sitesTable.client)} = ${canonicalClientNameSql(raceClientName)}`,
      );
    assert.deepEqual(sitesWithDeletedClientName, []);
  } finally {
    if (!barrierReleased) {
      await blocker.query("ROLLBACK").catch(() => undefined);
    }
    await Promise.allSettled(
      [deleteRequest, updateRequest].filter(
        (request): request is Promise<Response> => request !== undefined,
      ),
    );
    blocker.release();
    await db.delete(sitesTable).where(eq(sitesTable.id, raceSite.id));
    await db.delete(clientsTable).where(eq(clientsTable.id, raceClient.id));
  }
});

test("client deletion waits for site creation and returns a conflict after it commits", async () => {
  const raceClientName = `Клиент обратной гонки ${randomUUID()}`;
  const raceSiteName = `Объект обратной гонки ${randomUUID()}`;
  const [raceClient] = await db
    .insert(clientsTable)
    .values({ name: raceClientName })
    .returning({ id: clientsTable.id });
  createdClientIds.push(raceClient.id);

  let markSiteInserted!: () => void;
  const siteInserted = new Promise<void>((resolve) => {
    markSiteInserted = resolve;
  });
  let releaseSiteInsert!: () => void;
  const siteInsertReleased = new Promise<void>((resolve) => {
    releaseSiteInsert = resolve;
  });
  pauseNextSiteInsert = {
    inserted: markSiteInserted,
    release: siteInsertReleased,
  };

  let insertReleased = false;
  let createRequest: Promise<Response> | undefined;
  let deleteRequest: Promise<Response> | undefined;
  const observer = await pool.connect();

  try {
    createRequest = fetch(`${baseUrl}/sites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: raceSiteName,
        address: "Тестовый адрес",
        branch: "Тестовый куст",
        customer: siteTradeName,
        client: raceClientName,
        clientId: raceClient.id,
        manager: "Тестовый менеджер",
        director: "Тестовый руководитель",
        project: "Тестовый проект",
      }),
    });
    await siteInserted;

    deleteRequest = fetch(`${baseUrl}/clients/${raceClient.id}`, {
      method: "DELETE",
    });
    await waitForBlockedTableLock(
      observer.query.bind(observer),
      "clients",
    );

    releaseSiteInsert();
    insertReleased = true;

    const [createResponse, deleteResponse] = await Promise.all([
      createRequest,
      deleteRequest,
    ]);
    assert.equal(createResponse.status, 201);
    assert.equal(deleteResponse.status, 409);
    assert.equal(
      ((await deleteResponse.json()) as { code?: string }).code,
      "CLIENT_HAS_SITES",
    );

    const [remainingClient] = await db
      .select({ id: clientsTable.id, name: clientsTable.name })
      .from(clientsTable)
      .where(eq(clientsTable.id, raceClient.id));
    assert.deepEqual(remainingClient, {
      id: raceClient.id,
      name: raceClientName,
    });

    const [createdSite] = await db
      .select({
        id: sitesTable.id,
        client: sitesTable.client,
        clientId: sitesTable.clientId,
      })
      .from(sitesTable)
      .where(eq(sitesTable.name, raceSiteName));
    assert.ok(createdSite);
    assert.equal(createdSite.clientId, raceClient.id);
    assert.equal(createdSite.client, raceClientName);
  } finally {
    pauseNextSiteInsert = undefined;
    if (!insertReleased) releaseSiteInsert();
    await Promise.allSettled(
      [createRequest, deleteRequest].filter(
        (request): request is Promise<Response> => request !== undefined,
      ),
    );
    observer.release();
    await db.delete(sitesTable).where(eq(sitesTable.name, raceSiteName));
    await db.delete(clientsTable).where(eq(clientsTable.id, raceClient.id));
  }
});
