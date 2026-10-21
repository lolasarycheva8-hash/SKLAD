import assert from "node:assert/strict";
import { test } from "node:test";
import { orderMatchesTab, isOrderBilled, ORDER_STATUS_LABELS, formatPeriod } from "./order-status.ts";

test("tabs filter by operational status", () => {
  for (const s of ["draft", "shipped", "delivered"] as const) assert.ok(orderMatchesTab(s, "work"));
  assert.ok(!orderMatchesTab("awaiting_payment", "work"));
  assert.ok(orderMatchesTab("awaiting_payment", "awaiting"));
  assert.ok(orderMatchesTab("paid", "paid"));
  assert.ok(!orderMatchesTab("delivered", "paid"));
});

test("billed orders are locked; labels are Russian", () => {
  assert.ok(isOrderBilled({ status: "delivered", summaryId: "x" }));
  assert.ok(!isOrderBilled({ status: "delivered", summaryId: null }));
  assert.equal(ORDER_STATUS_LABELS.awaiting_payment, "Ожидает оплаты");
  assert.equal(formatPeriod("2026-01", "2026-03"), "январь 2026 — март 2026");
});
