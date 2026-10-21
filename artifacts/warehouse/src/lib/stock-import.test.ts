import assert from "node:assert/strict";
import test from "node:test";

import { serverBulkErrors, templateHeaders, validateStockRows } from "./stock-import.ts";

const sites = [{ id: "a", name: "Лесная 5" }, { id: "b", name: "Дубль" }, { id: "c", name: "дубль" }];
const h = templateHeaders("spare_parts");
const row = (o: Record<string, unknown>) => Object.fromEntries(h.map((k) => [k, o[k] ?? ""]));

test("valid rows resolve site, defaults and sku", () => {
  const r = validateStockRows("spare_parts", [row({ Наименование: "Фильтр", Артикул: "F-1", Количество: 3, Объект: "лесная 5", Состояние: "новое" })], h, sites);
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows[0].siteId, "a");
  assert.equal(r.rows[0].condition, "Новое");
  assert.equal(r.rows[0].sku, "F-1");
  assert.equal(r.rows[0].status, "На складе");
});

test("errors carry row numbers and reject all rows", () => {
  const r = validateStockRows("spare_parts", [
    row({ Наименование: "A", Артикул: "X", Количество: 1 }),
    row({ Наименование: "", Артикул: "x", Количество: -2, Объект: "Дубль" }),
  ], h, sites);
  assert.equal(r.rows.length, 0);
  assert.ok(r.errors.every((e) => e.rowNumber === 3));
  assert.equal(r.errors.length, 4);
  assert.ok(r.errors.some((e) => e.message.includes("дубликат")));
});

test("equipment requires quantity 1 and flags existing numbers", () => {
  const eh = templateHeaders("equipment");
  const r = validateStockRows("equipment", [{ Наименование: "Насос", "Инвентарный номер": "INV-1", Количество: 2 }], eh, sites, ["inv-1"]);
  assert.equal(r.errors.length, 2);
});

test("missing headers fail fast", () => {
  const r = validateStockRows("equipment", [], ["Наименование"], sites);
  assert.equal(r.errors[0].rowNumber, null);
});

test("server bulk errors map to sheet rows", () => {
  const e = serverBulkErrors({ data: { error: "x", errors: [{ row: 1, field: "sku", error: "дубликат" }] } });
  assert.deepEqual(e, [{ rowNumber: 2, message: "sku: дубликат" }]);
});
