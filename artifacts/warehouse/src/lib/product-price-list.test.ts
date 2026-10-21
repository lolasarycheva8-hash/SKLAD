import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { buildProductPriceList } from "./product-price-list.ts";

test("price list XLSX has required heading, Moscow date and only sale fields", () => {
  const products = [
    { name: "Ящик", unit: "шт.", price: 1234.56, purchasePrice: 777, supplier: "Private" },
    { name: "=Товар", unit: "уп.", price: 0, purchasePrice: 999, supplier: "Private" },
  ];
  const { workbook, filename } = buildProductPriceList(
    products, new Date("2026-10-01T21:30:00Z"),
  );
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const read = XLSX.read(bytes, { type: "buffer", cellNF: true });
  const sheet = read.Sheets["ПРАЙС"];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  assert.deepEqual(rows, [
    ["ПРАЙС"], ["ООО ТД Альянс"], ["Дата формирования прайса: 02.10.2026"], [],
    ["Наименование товара", "Единица измерения", "Цена продажная"],
    ["=Товар", "уп.", 0], ["Ящик", "шт.", 1234.56],
  ]);
  assert.equal(sheet.A6.t, "s");
  assert.equal(sheet.A6.f, undefined);
  assert.equal(sheet.C7.t, "n");
  assert.equal(sheet.C7.z, "#,##0.00");
  assert.equal(sheet["!merges"]?.length, 3);
  assert.equal(filename, "ПРАЙС_02.10.2026.xlsx");
  assert.equal(products[0].name, "Ящик");
});

test("empty price list builder retains document structure", () => {
  const { workbook } = buildProductPriceList([]);
  assert.equal(workbook.Sheets["ПРАЙС"]["!ref"], "A1:C5");
});