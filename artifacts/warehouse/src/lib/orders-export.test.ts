import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import type { Order } from "@workspace/api-client-react";
import { buildOrdersWorkbook } from "./orders-export.ts";

const orders: Order[] = [
  {
    id: "order-1", clientId: "client-1", clientName: "=Первый клиент",
    siteId: "site-1", siteName: "Магазин", siteAddress: "@Адрес",
    createdAt: "2026-02-01T23:30:00.000Z", note: "+важно",
    plannedMonth: "2026-03", monthFromDelivery: true, deliveryFromAdditionalOrder: true,
    status: "paid", orderNumber: "Z-1", summaryId: "s-1", fulfillmentDeliveryId: null,
    isPaid: true, paidAmount: 42.5, overpaidAmount: 2.5, totalAmount: 40,
    items: [
      { id: "item-1", productId: "p-1", productName: "=Товар", quantity: 2, price: 12.5, shippedQuantity: 0, remainingQuantity: 2 },
      { id: "item-2", productId: "p-2", productName: "Другой", quantity: 3, price: 5, shippedQuantity: 0, remainingQuantity: 3 },
    ],
  },
  {
    id: "order-2", clientId: "client-2", clientName: "Второй клиент",
    siteId: null, siteName: null, siteAddress: null,
    createdAt: "2026-02-02T08:00:00.000Z", note: null,
    plannedMonth: null, monthFromDelivery: false, deliveryFromAdditionalOrder: false,
    status: "draft", orderNumber: "Z-2", summaryId: null, fulfillmentDeliveryId: null,
    isPaid: false, paidAmount: 0, overpaidAmount: 0, totalAmount: 0, items: [],
  },
];

test("XLSX exports every order once and each item with typed monetary cells and literal text", () => {
  const book = XLSX.read(buildOrdersWorkbook(orders), { type: "array", cellNF: true });
  assert.deepEqual(book.SheetNames, ["Состав заказов", "Заказы"]);
  const summary = XLSX.utils.sheet_to_json<Record<string, string | number>>(book.Sheets["Заказы"], { defval: "" });
  const details = XLSX.utils.sheet_to_json<Record<string, string | number>>(book.Sheets["Состав заказов"], { defval: "" });

  assert.equal(summary.length, 2);
  assert.equal(summary[0]["ID заказа"], "order-1");
  assert.equal(summary[1]["ID заказа"], "order-2");
  assert.equal(summary[0]["Дата заказа (МСК)"], "02.02.2026, 02:30");
  assert.equal(summary[0]["Месяц плана"], "2026-03");
  assert.equal(summary[0]["Источник месяца"], "Доставка");
  assert.equal(summary[1]["Месяц плана"], "");
  assert.equal(details[0]["Месяц плана"], "2026-03");
  assert.equal(summary[0]["Сумма заказа"], 40);
  assert.equal(summary[0]["Оплачено"], 42.5);
  assert.equal(summary[0]["Переплата"], 2.5);
  assert.equal(summary[0]["Статус"], "Оплачен");
  assert.equal(summary[1]["Статус"], "Черновик");
  assert.equal(summary[0]["Примечание"], "+важно");
  assert.equal(summary[0]["Товары и количество"], "=Товар — 2; Другой — 3");
  assert.equal(summary[1]["Товары и количество"], "");
  assert.equal(book.Sheets["Заказы"].L2.t, "s");
  assert.equal(book.Sheets["Заказы"].L2.f, undefined);
  assert.equal(details.length, 2);
  assert.deepEqual(details.map((row) => row["Товар"]), ["=Товар", "Другой"]);
  assert.deepEqual(details.map((row) => row["Количество"]), [2, 3]);
  assert.deepEqual(details.map((row) => row["Цена за единицу"]), [12.5, 5]);
  assert.deepEqual(details.map((row) => row["Сумма позиции"]), [25, 15]);
  assert.equal(details[0]["Клиент"], "=Первый клиент");
  assert.equal(details[0]["Адрес"], "@Адрес");
  assert.equal("Сумма заказа" in details[0], false);

  const summaryMoney = book.Sheets["Заказы"].G2;
  const itemMoney = book.Sheets["Состав заказов"].I2;
  assert.equal(summaryMoney.t, "n");
  assert.match(summaryMoney.z!, /0\.00/);
  assert.equal(itemMoney.t, "n");
  assert.match(itemMoney.z!, /0\.00/);
  assert.equal(book.Sheets["Состав заказов"].G2.t, "n");
  assert.equal(book.Sheets["Состав заказов"].F2.t, "s");
  assert.equal(book.Sheets["Состав заказов"].F2.f, undefined);
  assert.equal(book.Sheets["Заказы"].C2.f, undefined);
  assert.equal(book.Sheets["Заказы"].K2.f, undefined);
});