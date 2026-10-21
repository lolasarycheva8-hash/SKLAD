import assert from "node:assert/strict";
import { test } from "node:test";
import { groupBillingLines, orderNumber, resolveOrderStatus, validBillingPeriod } from "./order-lifecycle";
import { ListShipmentOrderLookupResponse } from "@workspace/api-zod";

const draft = { isPaid: false, activePhoto: false, activeDelivery: false, shipped: false };
test("all five lifecycle statuses and evidence (approval is not required)", () => {
  assert.equal(resolveOrderStatus(draft), "draft");
  assert.equal(resolveOrderStatus({ ...draft, shipped: true }), "shipped");
  assert.equal(resolveOrderStatus({ ...draft, actualDate: "2026-01-01", activeDelivery: true }), "draft");
  assert.equal(resolveOrderStatus({ ...draft, activePhoto: true, activeDelivery: true }), "draft");
  assert.equal(resolveOrderStatus({ ...draft, actualDate: "2026-01-01", activeDelivery: true, activePhoto: true }), "delivered");
  assert.equal(resolveOrderStatus({ ...draft, actualDate: "2026-01-01", activePhoto: true }), "draft");
  assert.equal(resolveOrderStatus({ ...draft, summary: { paidAt: null } }), "awaiting_payment");
  assert.equal(resolveOrderStatus({ ...draft, isPaid: true, summary: { paidAt: null } }), "awaiting_payment");
  assert.equal(resolveOrderStatus({ ...draft, summary: { paidAt: new Date() } }), "paid");
  assert.equal(resolveOrderStatus({ ...draft, isPaid: true }), "paid");
});
test("billing periods are inclusive ISO months and reject empty/reversed/invalid values", () => {
  for (const [from, to] of [["", ""], ["2026-00", "2026-12"], ["2026-01", "2026-13"], ["2026-02", "2026-01"], ["26-01", "2026-01"], ["2026-1", "2026-01"]]) {
    assert.equal(validBillingPeriod(from, to), false);
  }
  assert.equal(validBillingPeriod("2026-01", "2026-01"), true);
  assert.equal(validBillingPeriod("2025-12", "2026-02"), true);
});
test("grouping keeps original product+price rows, never replaces price with current catalogue price", () => {
  const lines = groupBillingLines([
    { productId: "a", productName: "Old product", unit: "шт", quantity: 1.25, price: 10 },
    { productId: "a", productName: "Old product", unit: "шт", quantity: 2.75, price: 10 },
    { productId: "a", productName: "Old product", unit: "шт", quantity: 3, price: 12 },
    { productId: "b", productName: "Other", unit: "кг", quantity: 2, price: 10 },
  ]);
  assert.deepEqual(lines.map((i) => [i.productId, i.quantity, i.price, i.total]), [
    ["a", 4, 10, 40], ["a", 3, 12, 36], ["b", 2, 10, 20],
  ]);
});
test("stable source number never collides on UUID prefix", () => {
  assert.notEqual(orderNumber("12345678-a"), orderNumber("12345678-b"));
  assert.equal(orderNumber("12345678-a"), orderNumber("12345678-a"));
});
test("shipment lookup validation retains lifecycle and billing identity for the picker", () => {
  const ids = [
    "f5a814f4-3dba-4caa-a3d1-d6135d6a6a60",
    "f5a814f4-3dba-4caa-a3d1-d6135d6a6a61",
    "f5a814f4-3dba-4caa-a3d1-d6135d6a6a62",
  ];
  const rows = ListShipmentOrderLookupResponse.parse([
    { id: ids[0], clientName: "Test", isPaid: false, status: "shipped", summaryId: null, items: [] },
    { id: ids[1], clientName: "Test", isPaid: false, status: "awaiting_payment", summaryId: ids[2], items: [] },
    { id: ids[2], clientName: "Test", isPaid: true, status: "paid", summaryId: null, items: [] },
  ]);
  assert.deepEqual(rows.map((r) => [r.status, r.summaryId]), [
    ["shipped", null], ["awaiting_payment", ids[2]], ["paid", null],
  ]);
  assert.equal(ListShipmentOrderLookupResponse.safeParse([
    { id: ids[0], clientName: "Test", isPaid: false, items: [] },
  ]).success, false);
});