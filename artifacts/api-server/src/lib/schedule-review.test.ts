import assert from "node:assert/strict";
import { test } from "node:test";
import { planSchedule, type ScheduleState } from "./schedule-review";

const base: ScheduleState = {
  sites: [{ id: "s", name: "Магазин 42", deliveryType: "Обычная" }],
  drivers: [{ id: "u", name: "Иванов Иван Иванович" }, { id: "v", name: "Петров Пётр" }],
  deliveries: [{ id: "d", siteId: "s", driverUserId: "u", plannedDate: "2026-10-01",
    actualDate: null, actApprovedAt: null, orderId: null, correctedPlannedDate: null, deletionPendingAt: null }],
  frozenIds: [],
};
const row = { row: 2, siteName: "Магазин 42", driverName: "Иванов Иван", plannedDate: "2026-10-02" };
test("unique shortened driver and name whitespace resolve; changes preserve target identity", () => {
  const p = planSchedule("2026-10", [{ ...row, siteName: " магазин  42 " }], base);
  assert.equal(p.rows[0].status, "update");
  assert.equal(p.rows[0].newDriver, "Иванов Иван Иванович");
  assert.equal(p.targets.get(2)?.deliveryId, "d");
  assert.equal(planSchedule("2026-10", [{ ...row, plannedDate: "2026-10-01" }], base).rows[0].status, "unchanged");
});
test("null dates supported; invalid and other-month dates rejected", () => {
  assert.equal(planSchedule("2026-10", [{ ...row, plannedDate: null }], base).rows[0].status, "update");
  for (const plannedDate of ["2026-10-32", "2026-11-01", "invalid", ""]) {
    assert.equal(planSchedule("2026-10", [{ ...row, plannedDate }], base).rows[0].status, "conflict");
  }
});
test("completed, approved, pending cleanup, billed and order deliveries are protected", () => {
  for (const patch of [{ actualDate: "2026-10-01" }, { actApprovedAt: "now" }, { deletionPendingAt: "now" }, { orderId: "order" }]) {
    const state = { ...base, deliveries: [{ ...base.deliveries[0], ...patch }] };
    assert.equal(planSchedule("2026-10", [row], state).rows[0].status, "protected");
  }
  assert.equal(planSchedule("2026-10", [row], { ...base, frozenIds: ["d"] }).rows[0].status, "protected");
});
test("duplicate rows, ambiguous deliveries, unknown site and driver cannot apply", () => {
  assert.ok(planSchedule("2026-10", [row, { ...row, row: 3 }], base).rows.every(r => r.status === "conflict"));
  assert.equal(planSchedule("2026-10", [row], { ...base, deliveries: [...base.deliveries, { ...base.deliveries[0], id: "other" }] }).rows[0].status, "conflict");
  for (const patch of [{ siteName: "unknown" }, { driverName: "unknown" }]) {
    assert.equal(planSchedule("2026-10", [{ ...row, ...patch }], base).rows[0].status, "conflict");
  }
  assert.equal(planSchedule("2026-10", [row], { ...base, drivers: [...base.drivers, { id: "x", name: "Иванов Иван Петрович" }] }).rows[0].status, "conflict");
});
test("missing delivery is proposed as new; unseen deliveries never become actions; fingerprint tracks state", () => {
  const p = planSchedule("2026-10", [row], base);
  assert.equal(planSchedule("2026-10", [row], { ...base, deliveries: [] }).rows[0].status, "create");
  assert.notEqual(planSchedule("2026-10", [row], { ...base, frozenIds: ["d"] }).fingerprint, p.fingerprint);
  assert.equal(planSchedule("2026-10", [], base).rows.length, 0);
});
