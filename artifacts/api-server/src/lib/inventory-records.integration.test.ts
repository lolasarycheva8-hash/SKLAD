import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { eq, inArray, like } from "drizzle-orm";
import { clientsTable, db, inventoryRecordsTable, pool, sitesTable } from "@workspace/db";
import type { InventoryRecord, InventoryRecordImportError, InventoryRecordInput } from "@workspace/api-zod";
import type { AuthenticatedAppUser } from "./user-roles";
import inventoryRecordsRouter from "../routes/inventory-records";
import sitesRouter from "../routes/sites";

const prefix = `inventory-test-${randomUUID()}`;
let clientId = "";
let activeSiteId = "";
let archivedSiteId = "";
let baseUrl = "";
const admin: AuthenticatedAppUser = {
  id: randomUUID(),
  clerkUserId: prefix,
  email: `${prefix}@example.test`,
  name: "Inventory test administrator",
  phone: null,
  role: "admin",
  editableSections: [],
  isDriver: false,
  assignedSiteIds: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
  // Only this isolated test app injects users; production remains behind Clerk.
  const role = req.header("x-test-role");
  req.appUser = role === "anonymous" ? undefined : {
    ...admin,
    role: role === "manager" ? "manager" : role === "logistician" ? "logistician" : role === "driver" ? "driver" : "admin",
    editableSections: ["inventory", "sites"],
  };
  next();
});
app.use(inventoryRecordsRouter);
app.use(sitesRouter);
const server = app.listen(0);

function input(kind: InventoryRecordInput["kind"] = "consumables", suffix = randomUUID()): InventoryRecordInput {
  return {
    kind,
    name: `${prefix}-${suffix}`,
    quantity: kind === "equipment" ? 1 : 3.5,
    unit: kind === "equipment" ? "шт" : "л",
    condition: "новое",
    status: "на складе",
    ...(kind === "equipment" ? { inventoryNumber: `${prefix}-${suffix}` } : { sku: `${prefix}-${suffix}` }),
  };
}

async function request(path = "", method = "GET", body?: unknown, role = "admin") {
  const response = await fetch(`${baseUrl}/inventory-records${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-test-role": role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Assertions below exercise multiple generated response shapes and errors.
  const data: any = response.status === 204 ? null : await response.json();
  return { status: response.status, data };
}

before(async () => {
  if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const [client] = await db.insert(clientsTable).values({ name: prefix }).returning();
  clientId = client.id;
  const sites = await db.insert(sitesTable).values([
    {
      name: `${prefix}-active`, address: "Тест", branch: "Тест", client: prefix,
      clientId, manager: "Тест", director: "Тест", project: "Тест",
    },
    {
      name: `${prefix}-archived`, address: "Тест", branch: "Тест", client: prefix,
      clientId, manager: "Тест", director: "Тест", project: "Тест", closedFrom: "2020-01-01",
    },
  ]).returning();
  activeSiteId = sites[0].id;
  archivedSiteId = sites[1].id;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  // Delete only records created by this test; never alter production fixtures.
  await db.delete(inventoryRecordsTable).where(like(inventoryRecordsTable.name, `${prefix}%`));
  if (activeSiteId && archivedSiteId) await db.delete(sitesTable).where(inArray(sitesTable.id, [activeSiteId, archivedSiteId]));
  if (clientId) await db.delete(clientsTable).where(eq(clientsTable.id, clientId));
  await pool.end();
});

test("CRUD persists each kind, filters by kind/site, clears optional fields and deletes", async () => {
  for (const kind of ["equipment", "consumables", "spare_parts"] as const) {
    const created = await request("", "POST", { ...input(kind), siteId: activeSiteId, notes: "Заметка", model: "M1" });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.kind, kind);
    const id = created.data.id;
    const [stored] = await db.select().from(inventoryRecordsTable).where(eq(inventoryRecordsTable.id, id));
    assert.equal(stored.siteId, activeSiteId);
    const listed = await request(`?kind=${kind}&siteId=${activeSiteId}`);
    assert.equal(listed.status, 200);
    assert(listed.data.some((row: InventoryRecord) => row.id === id));
    assert(listed.data.every((row: InventoryRecord) => row.kind === kind && row.siteId === activeSiteId));
    const updated = await request(`/${id}`, "PATCH", { notes: null, model: null, siteId: null, status: "в работе" });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.notes, null);
    assert.equal(updated.data.model, null);
    assert.equal(updated.data.siteId, null);
    assert.equal(updated.data.status, "в работе");
    assert.equal((await request(`/${id}`, "DELETE")).status, 204);
    assert.equal((await request(`/${id}`, "DELETE")).status, 404);
  }
});

test("all inventory routes forbid non-admin roles even with legacy inventory/sites permissions", async () => {
  for (const role of ["manager", "logistician", "driver", "anonymous"]) {
    for (const [path, method, body] of [
      ["", "GET", undefined],
      ["", "POST", input()],
      ["/bulk", "POST", { rows: [input()] }],
      [`/${randomUUID()}`, "PATCH", { notes: "нет" }],
      [`/${randomUUID()}`, "DELETE", undefined],
    ] as const) {
      assert.equal((await request(path, method, body, role)).status, 403);
    }
  }
});

test("identity, quantity, whitespace, immutable kind and parameter validation", async () => {
  for (const invalid of [
    { ...input("equipment"), inventoryNumber: null },
    { ...input("equipment"), quantity: 2 },
    { ...input(), sku: null },
    { ...input("spare_parts"), sku: "   " },
    { ...input(), name: "   " },
    { ...input(), quantity: -1 },
    { ...input(), quantity: "3" },
    { ...input(), quantity: 1000000001 },
    { ...input(), siteId: "not-uuid" },
  ]) {
    assert.equal((await request("", "POST", invalid)).status, 400, JSON.stringify(invalid));
  }
  const created = await request("", "POST", input("equipment"));
  assert.equal(created.status, 201);
  assert.equal((await request(`/${created.data.id}`, "PATCH", { kind: "spare_parts" })).status, 400);
  assert.equal((await request(`/${created.data.id}`, "PATCH", { inventoryNumber: null })).status, 400);
  assert.equal((await request(`/${created.data.id}`, "PATCH", {})).status, 400);
  assert.equal((await request("/not-uuid", "PATCH", { notes: null })).status, 400);
  assert.equal((await request(`/${randomUUID()}`, "PATCH", { notes: null })).status, 404);
  assert.equal((await request("?kind=unknown")).status, 400);
  assert.equal((await request("?siteId=invalid")).status, 400);
});

test("existing and within-file duplicates reject entire import; no overwrite; SKU scoped per kind", async () => {
  const original = input();
  const created = await request("", "POST", original);
  assert.equal(created.status, 201);
  const duplicate = { ...original, sku: `  ${original.sku!.toUpperCase()}  `, quantity: 10 };
  assert.equal((await request("", "POST", duplicate)).status, 409);
  const valid = input();
  const bulk = await request("/bulk", "POST", { rows: [valid, duplicate] });
  assert.equal(bulk.status, 409);
  assert.equal((bulk.data as InventoryRecordImportError).errors[0].row, 2);
  assert.equal((bulk.data as InventoryRecordImportError).errors[0].field, "sku");
  assert.equal((await db.select().from(inventoryRecordsTable).where(eq(inventoryRecordsTable.sku, valid.sku!))).length, 0);
  const [stored] = await db.select().from(inventoryRecordsTable).where(eq(inventoryRecordsTable.id, created.data.id));
  assert.equal(stored.quantity, 3.5);
  const repeated = input("equipment");
  const withinFile = await request("/bulk", "POST", { rows: [repeated, { ...repeated, inventoryNumber: repeated.inventoryNumber!.toUpperCase() }] });
  assert.equal(withinFile.status, 409);
  assert.deepEqual(withinFile.data.errors.map((row: { row: number }) => row.row), [1, 2]);
  const scoped = await request("/bulk", "POST", { rows: [input(), { ...original, kind: "spare_parts" }] });
  assert.equal(scoped.status, 201);
  assert.equal(scoped.data.created, 2);
  assert.equal(scoped.data.records.length, 2);
  const another = await request("", "POST", input());
  assert.equal((await request(`/${another.data.id}`, "PATCH", { sku: original.sku })).status, 409);
});

test("bulk validation reports one-based row errors and rolls back valid rows", async () => {
  const valid = input();
  for (const invalid of [
    { ...input(), quantity: -1 },
    { ...input(), sku: null },
    { ...input(), siteId: archivedSiteId },
    { ...input(), siteId: randomUUID() },
  ]) {
    const result = await request("/bulk", "POST", { rows: [valid, invalid] });
    assert.equal(result.status, 400, JSON.stringify(result.data));
    assert.equal(result.data.errors[0].row, 2);
    assert.equal((await db.select().from(inventoryRecordsTable).where(eq(inventoryRecordsTable.sku, valid.sku!))).length, 0);
  }
  assert.equal((await request("/bulk", "POST", { rows: [] })).status, 400);
  assert.equal((await request("/bulk", "POST", { rows: Array.from({ length: 1001 }, () => valid) })).status, 400);
});

test("site assignment rejects missing/archived sites and FK prevents deleting an assigned site", async () => {
  assert.equal((await request("", "POST", { ...input(), siteId: archivedSiteId })).status, 400);
  assert.equal((await request("", "POST", { ...input(), siteId: randomUUID() })).status, 400);
  const created = await request("", "POST", { ...input(), siteId: activeSiteId });
  assert.equal(created.status, 201);
  const uppercase = await request("", "POST", { ...input(), siteId: activeSiteId.toUpperCase() });
  assert.equal(uppercase.status, 201);
  assert.equal(uppercase.data.siteId, activeSiteId);
  assert.equal((await request(`/${created.data.id}`, "PATCH", { siteId: archivedSiteId })).status, 400);
  const deletion = await fetch(`${baseUrl}/sites/${activeSiteId}`, {
    method: "DELETE",
    headers: { "x-test-role": "admin" },
  });
  assert.equal(deletion.status, 409);
  const deletionError = await deletion.json() as { error: string };
  assert.match(deletionError.error, /инвентарь/);
  assert.match(deletionError.error, /отвяжите.*другой объект/);
  const [preservedRecord] = await db.select().from(inventoryRecordsTable)
    .where(eq(inventoryRecordsTable.id, created.data.id));
  assert.equal(preservedRecord.siteId, activeSiteId);
  const [preservedSite] = await db.select().from(sitesTable)
    .where(eq(sitesTable.id, activeSiteId));
  assert.equal(preservedSite.id, activeSiteId);
  await assert.rejects(db.delete(sitesTable).where(eq(sitesTable.id, activeSiteId)));
});

test("database constraints independently enforce identities and quantities", async () => {
  const row = input("equipment");
  const created = await request("", "POST", row);
  assert.equal(created.status, 201);
  await assert.rejects(db.insert(inventoryRecordsTable).values({
    ...row, inventoryNumber: `  ${row.inventoryNumber!.toUpperCase()}  `,
  }));
  await assert.rejects(db.insert(inventoryRecordsTable).values({
    ...input("equipment"), quantity: 2,
  }));
  await assert.rejects(db.insert(inventoryRecordsTable).values({
    ...input("consumables"), sku: "   ",
  }));
  await assert.rejects(db.insert(inventoryRecordsTable).values({
    ...input("spare_parts"), quantity: -1,
  }));
});

test("concurrent duplicate imports yield exactly one success and one row conflict", async () => {
  const row = input("equipment");
  const results = await Promise.all([
    request("/bulk", "POST", { rows: [row] }),
    request("/bulk", "POST", { rows: [row] }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const failed = results.find((result) => result.status === 409)!;
  assert.equal(failed.data.errors[0].row, 1);
  const stored = await db.select().from(inventoryRecordsTable).where(eq(inventoryRecordsTable.inventoryNumber, row.inventoryNumber!));
  assert.equal(stored.length, 1);
});