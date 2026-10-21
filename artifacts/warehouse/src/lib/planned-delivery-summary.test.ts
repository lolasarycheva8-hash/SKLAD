import assert from "node:assert/strict";
import test from "node:test";
import {
  getPlannedDayTotals,
  getPlannedTotals,
  getPlanDueByDate,
  matchesPlannedDeliveryDay,
} from "./planned-delivery-summary.ts";

test("план к сегодняшнему дню включает сегодня независимо от факта и исключает архив и строки без даты", () => {
  const rows = [
    { plannedDate: "2026-10-01", actualDate: null },
    { plannedDate: "2026-10-04", actualDate: "2026-10-04", workflowStatus: "closed" as const },
    { plannedDate: "2026-10-05", actualDate: "2026-10-02" },
    { plannedDate: null, actualDate: null },
    { plannedDate: "2026-10-02", actualDate: null, archivedAt: "2026-10-03" },
  ];
  assert.equal(getPlanDueByDate(rows, "2026-10-04"), 2);
  assert.equal(getPlanDueByDate(rows, "2026-09-30"), 0);
  assert.equal(getPlanDueByDate(rows, "2026-11-01"), 3);
  assert.equal(getPlanDueByDate([], "2026-10-04"), 0);
  assert.equal(getPlanDueByDate(rows, "2026-10-04") / getPlannedTotals(rows).plan * 100, 2 / 3 * 100);
});

test("42 planned, 20 outstanding: other days' completions cannot inflate the plan", () => {
  const rows = [
    ...Array.from({ length: 20 }, () => ({
      plannedDate: "2026-09-11", actualDate: null,
      workflowStatus: "planned" as const,
    })),
    ...Array.from({ length: 22 }, () => ({
      plannedDate: "2026-09-11", actualDate: "2026-09-14",
      workflowStatus: "closed" as const,
    })),
    ...Array.from({ length: 49 }, () => ({
      plannedDate: "2026-09-10", actualDate: "2026-09-11",
      workflowStatus: "closed" as const,
    })),
  ];
  const totals = getPlannedDayTotals(rows, "2026-09-11");
  assert.deepEqual(
    { plan: totals.plan, done: totals.done, closed: totals.closed, failed: totals.failed },
    { plan: 42, done: 22, closed: 22, failed: 20 },
  );
  assert.equal(totals.completedPercent!.toFixed(1), "52.4");
  for (const status of ["plan", "done", "closed", "failed"] as const) {
    assert.equal(rows.filter(row => matchesPlannedDeliveryDay(row, "2026-09-11", status)).length, totals[status]);
  }
});

test("unapproved acts remain done; archived, undated and differently planned rows are excluded", () => {
  const rows = [
    { plannedDate: "2026-09-11", actualDate: "2026-08-31", workflowStatus: "done" as const, photosCount: 2 },
    { plannedDate: "2026-09-11", actualDate: "2026-10-01", workflowStatus: "closed" as const, photosCount: 1 },
    { plannedDate: "2026-09-11", actualDate: null, workflowStatus: "planned" as const, photosCount: 1 },
    { plannedDate: "2026-09-11", actualDate: "2026-09-11", workflowStatus: "closed" as const, archivedAt: "2026-09-14T00:00:00Z" },
    { plannedDate: null, actualDate: "2026-09-11" },
    { plannedDate: "2026-09-12", correctedPlannedDate: "2026-09-11", actualDate: "2026-09-11" },
  ];
  const totals = getPlannedDayTotals(rows, "2026-09-11");
  assert.equal(totals.plan, 3);
  assert.equal(totals.done, 2);
  assert.equal(totals.closed, 1);
  assert.equal(totals.failed, 1);
  assert.equal(totals.plan, totals.done + totals.failed);
  assert.equal(totals.completedPercent!.toFixed(1), "66.7");
});

test("no plan has no percentage, while a fully closed plan is 100 percent", () => {
  assert.equal(getPlannedDayTotals([], "2026-09-11").completedPercent, null);
  assert.equal(getPlannedDayTotals([{
    plannedDate: "2026-09-11", actualDate: "2026-09-12", workflowStatus: "closed",
  }], "2026-09-11").completedPercent, 100);
});

test("общий итог включает закрытые доставки в выполненные без двойного счёта", () => {
  const rows = [
    ...Array.from({ length: 201 }, () => ({
      plannedDate: "2026-09-15", actualDate: "2026-09-15", workflowStatus: "done" as const,
    })),
    ...Array.from({ length: 334 }, () => ({
      plannedDate: "2026-09-15", actualDate: "2026-09-15", workflowStatus: "closed" as const,
    })),
    ...Array.from({ length: 1775 }, () => ({
      plannedDate: "2026-09-15", actualDate: null,
    })),
  ];
  const totals = getPlannedTotals(rows);
  assert.equal(totals.plan, 2310);
  assert.equal(totals.done, 535);
  assert.equal(totals.closed, 334);
  assert.equal(totals.failed, 1775);
  assert.equal(totals.completedPercent?.toFixed(1), "23.2");
});