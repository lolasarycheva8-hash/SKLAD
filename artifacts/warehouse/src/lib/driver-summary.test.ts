import assert from "node:assert/strict";
import test from "node:test";
import { buildDriverSummary } from "./driver-summary.ts";

const driver = { id: "driver-1", name: "Водитель", email: "driver@example.test" };
const delivery = {
  driverUserId: driver.id,
  driver: driver.name,
  plannedDate: "2026-09-01",
  actualDate: null as string | null,
  scheduleMonth: "2026-09",
  workflowStatus: "planned" as "planned" | "done" | "closed",
};

test("counts original plan and actual completion on their own days; files do not mean approval", () => {
  const rows = buildDriverSummary([
    delivery,
    { ...delivery, actualDate: "2026-09-02", workflowStatus: "done", photosCount: 2, correctedPlannedDate: "2026-09-03" } as typeof delivery,
    { ...delivery, actualDate: "2026-09-02", workflowStatus: "closed" },
  ], [driver], "2026-09");
  assert.equal(rows[0].days.length, 30);
  assert.deepEqual(rows[0].days[0], { plan: 3, done: 0, closed: 0, failed: 1 });
  assert.deepEqual(rows[0].days[1], { plan: 0, done: 1, closed: 1, failed: 0 });
  assert.deepEqual(rows[0].days[2], { plan: 0, done: 0, closed: 0, failed: 0 });
});

test("groups by driver identity, includes idle drivers, archived assignments and unassigned rows", () => {
  const rows = buildDriverSummary([
    delivery,
    { ...delivery, driverUserId: "driver-2" },
    { ...delivery, driverUserId: "archived", driver: "Архивный" },
    { ...delivery, driverUserId: null, driver: "" },
  ], [driver, { ...driver, id: "driver-2" }, { ...driver, id: "idle" }], "2026-09");
  assert.equal(rows.length, 5);
  assert.equal(rows.find((row) => row.key === "driver-1")?.days[0].plan, 1);
  assert.equal(rows.find((row) => row.key === "driver-2")?.days[0].plan, 1);
  assert.equal(rows.find((row) => row.key === "idle")?.days[0].plan, 0);
  assert.equal(rows.at(-1)?.driver, "Не назначен");
});

test("keeps undated counts outside daily cells, rejects other month and counts legacy month", () => {
  const rows = buildDriverSummary([
    { ...delivery, plannedDate: null },
    { ...delivery, plannedDate: "2026-10-01", scheduleMonth: "2026-10" },
    { ...delivery, scheduleMonth: null },
    { ...delivery, plannedDate: "2026-09-30" },
  ], [driver], "2026-09");
  assert.equal(rows[0].undated, 1);
  assert.equal(rows[0].days[0].plan, 1);
  assert.equal(rows[0].days[29].failed, 1);
  assert.equal(rows[0].days.reduce((total, day) => total + day.plan, 0), 2);
});

test("supports month lengths and leap years without carrying data between months", () => {
  for (const [month, count] of [["2024-02", 29], ["2026-02", 28], ["2026-07", 31]] as const) {
    const rows = buildDriverSummary([delivery], [driver], month);
    assert.equal(rows[0].days.length, count);
    assert.equal(rows[0].days.reduce((total, day) => total + day.plan, 0), 0);
  }
  assert.deepEqual(buildDriverSummary([], [], "invalid"), []);
  assert.deepEqual(buildDriverSummary([], [], "2026-09"), []);
});