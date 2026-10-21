import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { eq, ilike, inArray } from "drizzle-orm";
import { db, movementsTable, pool, productsTable } from "@workspace/db";
import type { AuthenticatedAppUser } from "./user-roles.ts";
import productsRouter from "../routes/products.ts";

type ProductResponse = {
  id: string;
  name: string;
  sku: string;
  currentStock: number;
};

type BulkResponse = {
  products: ProductResponse[];
  created: number;
  updated: number;
};

const fixturePrefix = `product-import-${randomUUID()}`;
const trackedProductIds = new Set<string>();
const admin: AuthenticatedAppUser = {
  id: randomUUID(),
  clerkUserId: `${fixturePrefix}-admin`,
  email: `${fixturePrefix}@example.test`,
  name: "Product import integration admin",
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
  req.appUser = admin;
  req.log = {
    info() {},
    warn() {},
    error() {},
  } as unknown as typeof req.log;
  next();
});
app.use(productsRouter);

const server = app.listen(0);
let baseUrl = "";

function item(
  name: string,
  sku: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    sku,
    unit: "шт",
    purchasePrice: 12.5,
    price: 25,
    ...overrides,
  };
}

async function insertFixture(
  name: string,
  sku: string,
  movementQuantity?: number,
): Promise<{ id: string; name: string; sku: string }> {
  const [product] = await db
    .insert(productsTable)
    .values({
      name,
      sku,
      unit: "шт",
      purchasePrice: "12.50",
      price: "25.00",
    })
    .returning({
      id: productsTable.id,
      name: productsTable.name,
      sku: productsTable.sku,
    });

  assert.ok(product);
  trackedProductIds.add(product.id);

  if (movementQuantity !== undefined) {
    await db.insert(movementsTable).values({
      productId: product.id,
      type: "in",
      quantity: String(movementQuantity),
      reason: "Product import integration fixture",
    });
  }

  return product;
}

async function postBulk(items: Record<string, unknown>[]): Promise<{
  response: Response;
  body: unknown;
}> {
  const response = await fetch(`${baseUrl}/products/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });
  return { response, body: await response.json() };
}

function bulkBody(body: unknown): BulkResponse {
  assert.ok(body && typeof body === "object");
  const value = body as Record<string, unknown>;
  assert.ok(Array.isArray(value.products));
  assert.equal(typeof value.created, "number");
  assert.equal(typeof value.updated, "number");
  return value as unknown as BulkResponse;
}

function errorBody(body: unknown): string {
  assert.ok(body && typeof body === "object");
  const error = (body as Record<string, unknown>).error;
  if (typeof error !== "string" || error.length === 0) {
    assert.fail("response should contain a nonempty error string");
  }
  return error;
}

function assertSuccessStatus(status: number): void {
  assert.ok(status === 200 || status === 201, `unexpected success status ${status}`);
}

function assertRowMention(error: string, row: number): void {
  const rowPattern = new RegExp(
    `(?:row|строк\\w*).{0,30}\\b${row}\\b|\\b${row}\\b.{0,30}(?:row|строк\\w*)`,
    "i",
  );
  assert.match(error, rowPattern);
}

async function productsByNamePrefix(prefix: string) {
  return db
    .select()
    .from(productsTable)
    .where(ilike(productsTable.name, `${prefix}%`));
}

async function productsByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(productsTable).where(inArray(productsTable.id, ids));
}

async function movementsByProductIds(ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(movementsTable)
    .where(inArray(movementsTable.productId, ids));
}

before(async () => {
  assert.notEqual(
    process.env.NODE_ENV,
    "production",
    "product import integration fixtures must never run against production",
  );
  await new Promise<void>((resolve) => {
    if (server.listening) resolve();
    else server.once("listening", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  const discovered = await productsByNamePrefix(fixturePrefix);
  const productIds = [
    ...new Set([...trackedProductIds, ...discovered.map((product) => product.id)]),
  ];

  if (productIds.length > 0) {
    await db.delete(movementsTable).where(inArray(movementsTable.productId, productIds));
    await db.delete(productsTable).where(inArray(productsTable.id, productIds));
  }

  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await pool.end();
});

test("bulk import trims identity fields, returns counters, and repeats updates by the same ids", async () => {
  const existingSku = await insertFixture(
    `${fixturePrefix} SKU before`,
    `${fixturePrefix}-RENAME-SKU`,
    5,
  );
  const existingBlank = await insertFixture(
    `${fixturePrefix} existing blank`,
    "",
    6,
  );

  const items = [
    item(`  ${fixturePrefix} new sku  `, `  ${fixturePrefix}-NEW-SKU  `, {
      initialStock: 4,
    }),
    item(`  ${fixturePrefix} blank one  `, " \t ", { initialStock: 2 }),
    item(` ${fixturePrefix} blank two `, " ", { initialStock: 3 }),
    item(` ${fixturePrefix} SKU renamed `, ` ${fixturePrefix}-RENAME-SKU `, {
      initialStock: 99,
    }),
    item(`  ${fixturePrefix.toUpperCase()} EXISTING BLANK  `, " \t ", {
      initialStock: 100,
    }),
  ];

  const first = await postBulk(items);
  assertSuccessStatus(first.response.status);
  const firstBody = bulkBody(first.body);
  assert.equal(firstBody.created, 3);
  assert.equal(firstBody.updated, 2);
  assert.equal(firstBody.products.length, items.length);

  const expected = [
    { name: `${fixturePrefix} new sku`, sku: `${fixturePrefix}-NEW-SKU`, stock: 4 },
    { name: `${fixturePrefix} blank one`, sku: "", stock: 2 },
    { name: `${fixturePrefix} blank two`, sku: "", stock: 3 },
    { name: `${fixturePrefix} SKU renamed`, sku: `${fixturePrefix}-RENAME-SKU`, stock: 5 },
    {
      name: `${fixturePrefix.toUpperCase()} EXISTING BLANK`,
      sku: "",
      stock: 6,
    },
  ];
  assert.deepEqual(
    firstBody.products.map((product) => ({
      name: product.name,
      sku: product.sku,
      stock: product.currentStock,
    })),
    expected,
  );

  const firstIds = firstBody.products.map((product) => product.id);
  firstIds.forEach((id) => trackedProductIds.add(id));
  assert.equal(firstBody.products[3]?.id, existingSku.id);
  assert.equal(firstBody.products[4]?.id, existingBlank.id);

  const firstRows = await productsByIds(firstIds);
  assert.equal(firstRows.length, firstIds.length);
  assert.equal(firstRows.filter((product) => product.sku.trim() === "").length, 3);
  assert.equal(
    firstRows.some((product) => product.name !== product.name.trim()),
    false,
  );
  assert.equal(
    firstRows.some((product) => product.sku !== product.sku.trim()),
    false,
  );

  const firstMovements = await movementsByProductIds(firstIds);
  assert.equal(firstMovements.filter((movement) => movement.productId === existingSku.id).length, 1);
  assert.equal(
    firstMovements.filter((movement) => movement.productId === existingBlank.id).length,
    1,
  );
  assert.equal(firstMovements.length, 5);

  const repeated = await postBulk(items);
  assertSuccessStatus(repeated.response.status);
  const repeatedBody = bulkBody(repeated.body);
  assert.equal(repeatedBody.created, 0);
  assert.equal(repeatedBody.updated, items.length);
  assert.deepEqual(
    repeatedBody.products.map((product) => product.id),
    firstIds,
  );
  assert.deepEqual(
    repeatedBody.products.map((product) => product.currentStock),
    [4, 2, 3, 5, 6],
  );
  assert.equal((await movementsByProductIds(firstIds)).length, firstMovements.length);
});

test("duplicate sku or blank-sku name is rejected with a row error and writes nothing", async () => {
  const duplicateSku = `${fixturePrefix}-DUPLICATE-SKU`;
  const duplicateSkuResult = await postBulk([
    item(`${fixturePrefix} duplicate sku first`, ` ${duplicateSku} `, {
      initialStock: 8,
    }),
    item(`${fixturePrefix} duplicate sku second`, duplicateSku, {
      initialStock: 9,
    }),
  ]);
  assert.equal(duplicateSkuResult.response.status, 400);
  assertRowMention(errorBody(duplicateSkuResult.body), 2);
  assert.equal(
    (await db.select().from(productsTable).where(eq(productsTable.sku, duplicateSku))).length,
    0,
  );

  const duplicateName = `${fixturePrefix} duplicate blank name`;
  const duplicateNameResult = await postBulk([
    item(` ${duplicateName} `, " ", { initialStock: 4 }),
    item(` ${duplicateName.toUpperCase()} `, "\t", { initialStock: 5 }),
  ]);
  assert.equal(duplicateNameResult.response.status, 400);
  assertRowMention(errorBody(duplicateNameResult.body), 2);
  assert.equal((await productsByNamePrefix(duplicateName)).length, 0);
  assert.equal(
    (
      await db
        .select()
        .from(productsTable)
        .where(ilike(productsTable.name, `${duplicateName.toUpperCase()}%`))
    ).length,
    0,
  );
});

test("database case folding cannot resolve two blank-SKU rows to the same product", async () => {
  const prefix = `${fixturePrefix} unicode`;
  const first = `${prefix} İ`;
  const second = `${prefix} i`;
  assert.notEqual(first.toLowerCase(), second.toLowerCase());
  const result = await postBulk([
    item(first, "", { initialStock: 7 }),
    item(second, "", { initialStock: 9 }),
  ]);
  assert.equal(result.response.status, 400);
  assertRowMention(errorBody(result.body), 2);
  assertRowMention(errorBody(result.body), 3);
  assert.equal((await productsByNamePrefix(prefix)).length, 0);
});

test("an empty trimmed name is rejected without creating a product", async () => {
  const sku = `${fixturePrefix}-EMPTY-NAME`;
  const result = await postBulk([
    item(" \t\n ", ` ${sku} `, {
      initialStock: 7,
    }),
  ]);

  assert.equal(result.response.status, 400);
  assert.match(errorBody(result.body), /name|имя|назв/i);
  assert.equal(
    (await db.select().from(productsTable).where(eq(productsTable.sku, sku))).length,
    0,
  );
});

test("an ambiguous existing blank-sku name returns 409 and rolls back an earlier new row", async () => {
  const ambiguousName = `${fixturePrefix} ambiguous existing`;
  const firstExisting = await insertFixture(ambiguousName, "");
  const secondExisting = await insertFixture(` ${ambiguousName.toUpperCase()} `, "");
  const beforeRows = await productsByIds([firstExisting.id, secondExisting.id]);
  const beforeMovements = await movementsByProductIds([
    firstExisting.id,
    secondExisting.id,
  ]);
  const newSku = `${fixturePrefix}-ROLLBACK-NEW`;

  const result = await postBulk([
    item(`${fixturePrefix} rollback new`, newSku, { initialStock: 11 }),
    item(` ${ambiguousName.toUpperCase()} `, " ", { initialStock: 12 }),
  ]);

  assert.equal(result.response.status, 409);
  assert.match(errorBody(result.body), /ambig|неоднознач|несколь|multiple/i);
  assert.equal(
    (await db.select().from(productsTable).where(eq(productsTable.sku, newSku))).length,
    0,
  );
  assert.deepEqual(
    (await productsByIds([firstExisting.id, secondExisting.id])).sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    beforeRows.sort((a, b) => a.id.localeCompare(b.id)),
  );
  assert.deepEqual(
    (await movementsByProductIds([firstExisting.id, secondExisting.id])).sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    beforeMovements.sort((a, b) => a.id.localeCompare(b.id)),
  );
});