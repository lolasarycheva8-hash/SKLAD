import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  clientsTable,
  db,
  pool,
  sitesTable,
  tradeNamesTable,
} from "@workspace/db";
import type { AuthenticatedAppUser } from "./user-roles.ts";
import lookupsRouter from "../routes/lookups.ts";
import sitesRouter from "../routes/sites.ts";

const app = express();
app.use(express.json());

let actor: AuthenticatedAppUser;
app.use((req, _res, next) => {
  req.appUser = actor;
  req.log = {
    info() {},
    warn() {},
    error() {},
  } as unknown as typeof req.log;
  next();
});
app.use(sitesRouter);
app.use(lookupsRouter);

const server = app.listen(0);
let baseUrl = "";
let clientId = "";
let tradeName = "";
const createdSiteIds: string[] = [];
const fixtureSiteIds: string[] = [];

function user(
  role: AuthenticatedAppUser["role"],
  editableSections: AuthenticatedAppUser["editableSections"],
): AuthenticatedAppUser {
  const now = new Date();
  return {
    id: randomUUID(),
    clerkUserId: `site-branch-lookup-${role}-${randomUUID()}`,
    email: `${role}-${randomUUID()}@example.test`,
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

async function request(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

before(async () => {
  await new Promise<void>((resolve) => {
    if (server.listening) resolve();
    else server.once("listening", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const [client] = await db
    .insert(clientsTable)
    .values({ name: `Клиент веток ${randomUUID()}` })
    .returning({ id: clientsTable.id, name: clientsTable.name });
  clientId = client.id;
  tradeName = `Торговое название веток ${randomUUID()}`;
  await db.insert(tradeNamesTable).values({ name: tradeName });

  const branch = `Ветка lookup ${randomUUID()}`;
  const closedBranch = `Закрытая ветка lookup ${randomUUID()}`;
  const blankBranchSite = await db
    .insert(sitesTable)
    .values({
      name: `Объект пустой ветки ${randomUUID()}`,
      address: "Адрес",
      branch: " \t ",
      client: client.name,
      clientId,
      manager: "Менеджер",
      director: "Руководитель",
      project: "Проект",
    })
    .returning({ id: sitesTable.id });
  const fixtureSites = await db
    .insert(sitesTable)
    .values([
      {
        name: `Объект ветки lookup 1 ${randomUUID()}`,
        address: "Адрес",
        branch: `  ${branch}  `,
        client: client.name,
        clientId,
        manager: "Менеджер",
        director: "Руководитель",
        project: "Проект",
      },
      {
        name: `Объект ветки lookup 2 ${randomUUID()}`,
        address: "Адрес",
        branch,
        client: client.name,
        clientId,
        manager: "Менеджер",
        director: "Руководитель",
        project: "Проект",
        closedFrom: "2000-01-01",
      },
      {
        name: `Объект закрытой ветки lookup ${randomUUID()}`,
        address: "Адрес",
        branch: ` ${closedBranch} `,
        client: client.name,
        clientId,
        manager: "Менеджер",
        director: "Руководитель",
        project: "Проект",
        closedFrom: "2000-01-01",
      },
    ])
    .returning({ id: sitesTable.id });
  fixtureSiteIds.push(blankBranchSite[0]!.id, ...fixtureSites.map((site) => site.id));
});

after(async () => {
  const siteIds = [...fixtureSiteIds, ...createdSiteIds];
  if (siteIds.length > 0) {
    await db.delete(sitesTable).where(inArray(sitesTable.id, siteIds));
  }
  if (tradeName) {
    await db.delete(tradeNamesTable).where(eq(tradeNamesTable.name, tradeName));
  }
  if (clientId) {
    await db.delete(clientsTable).where(eq(clientsTable.id, clientId));
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await pool.end();
});

test("site branch lookup trims, deduplicates, includes closed sites, and ignores filters", async () => {
  actor = user("logistician", ["sites"]);
  const response = await request("/lookups/site-branches?search=does-not-exist");
  assert.equal(response.status, 200);
  const rows = (await response.json()) as Array<{ name: string }>;
  const names = rows.map((row) => row.name);
  const branch = names.find((name) => name.startsWith("Ветка lookup "));
  const closedBranch = names.find((name) => name.startsWith("Закрытая ветка lookup "));
  assert.ok(branch);
  assert.ok(closedBranch);
  assert.equal(names.filter((name) => name === branch).length, 1);
  assert.equal(names.some((name) => name.trim() === "" || name !== name.trim()), false);
});

test("single site creation requires a nonblank known trade name", async () => {
  actor = user("admin", []);
  const baseBody = {
    name: `Объект обязательного trade name ${randomUUID()}`,
    address: "Адрес",
    branch: "Новая ветка",
    clientId,
    manager: "Менеджер",
    director: "Руководитель",
    project: "Проект",
  };

  for (const customer of [undefined, "", " \t "]) {
    const response = await request("/sites", "POST", {
      ...baseBody,
      name: `${baseBody.name} ${customer === undefined ? "missing" : "blank"}`,
      ...(customer === undefined ? {} : { customer }),
    });
    assert.equal(response.status, 400);
  }

  const response = await request("/sites", "POST", {
    ...baseBody,
    customer: `  ${tradeName}  `,
  });
  assert.equal(response.status, 201);
  const created = (await response.json()) as { id: string; customer: string };
  createdSiteIds.push(created.id);
  assert.equal(created.customer, tradeName);

  const lookupResponse = await request("/lookups/site-branches");
  assert.equal(lookupResponse.status, 200);
  const lookupRows = (await lookupResponse.json()) as Array<{ name: string }>;
  assert.ok(lookupRows.some((row) => row.name === "Новая ветка"));
});

test("site branch lookup uses the sites section permission", async () => {
  actor = user("manager", []);
  assert.equal((await request("/lookups/site-branches")).status, 403);

  actor = user("manager", ["sites"]);
  assert.equal((await request("/lookups/site-branches")).status, 200);

  actor = user("driver", ["sites"]);
  assert.equal((await request("/lookups/site-branches")).status, 403);
});