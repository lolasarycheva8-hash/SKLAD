import assert from "node:assert/strict";
import test from "node:test";
import { deliveryProgressPercent, getDeliveryProgress } from "./delivery-progress.ts";

const rows = [
  { plannedDate: "2026-10-01", actualDate: "2026-10-03", workflowStatus: "closed", actApprovedAt: "2026-10-03T22:00:00Z" },
  { plannedDate: "2026-10-04", actualDate: null },
  { plannedDate: "2026-10-15", actualDate: "2026-10-04", workflowStatus: "done" },
  { plannedDate: "2026-10-05", actualDate: "2026-10-06", workflowStatus: "closed" },
  { plannedDate: null, actualDate: null },
  { plannedDate: "2026-09-30", actualDate: "2026-09-30" },
  { plannedDate: "2026-10-01", actualDate: "2026-10-01", archivedAt: "2026-10-02" },
];

test("period not done counts planned deliveries unfinished at period end, not plan minus all actuals", () => {
  const summary = getDeliveryProgress([
    { plannedDate: "2026-10-01", actualDate: null },
    { plannedDate: "2026-10-02", actualDate: "2026-10-16" },
    { plannedDate: "2026-10-03", actualDate: "2026-10-03" },
    { plannedDate: "2026-10-20", actualDate: "2026-10-04" },
    { plannedDate: "2026-10-01", actualDate: null, archivedAt: "2026-10-02" },
    { plannedDate: null, actualDate: null },
  ], "2026-10", "2026-10-16");
  assert.equal(summary.periodPlan, 3);
  assert.equal(summary.periodFact, 2);
  assert.equal(summary.periodNotDone, 2);
  assert.equal(deliveryProgressPercent(summary.periodNotDone, summary.periodPlan), "66,7%");
  assert.equal(getDeliveryProgress(rows, "2026-10", "2026-10-01").periodNotDone, 0);
  assert.equal(getDeliveryProgress(rows, "2026-10", "2026-09-30").periodNotDone, 0);
});

test("month and period use separate denominators, actual dates include early/late completion", () => {
  const summary = getDeliveryProgress(rows, "2026-10", "2026-10-04");
  assert.equal(summary.monthPlan, 4);
  assert.equal(summary.done, 2);
  assert.equal(summary.closed, 1);
  assert.equal(summary.periodPlan, 1);
  assert.equal(summary.periodFact, 1);
  assert.equal(summary.periodClosed, 1); // Approval after the period still closes its delivery.
  assert.equal(summary.through, "2026-10-03");
  assert.equal(summary.todayPlan, 1);
  assert.equal(summary.todayFact, 1);
  assert.equal(summary.todayClosed, 0);
  assert.equal(deliveryProgressPercent(summary.done, summary.monthPlan), "50%");
  assert.equal(deliveryProgressPercent(summary.periodFact, summary.periodPlan), "100%");
});

test("past/future months, empty plan and overachievement stay meaningful", () => {
  const future = getDeliveryProgress(rows, "2026-10", "2026-09-30");
  assert.equal(future.monthPlan, 4);
  assert.equal(future.periodPlan, 0);
  assert.equal(future.done, 0);
  assert.equal(future.started, false);
  const past = getDeliveryProgress(rows, "2026-10", "2026-11-04");
  assert.equal(past.through, "2026-10-31");
  assert.equal(past.periodPlan, 4);
  assert.equal(past.done, 3);
  assert.equal(deliveryProgressPercent(0, 0), "—");
  assert.equal(deliveryProgressPercent(3, 2), "150%");
  assert.equal(getDeliveryProgress([], "2028-02", "2028-03-01").through, "2028-02-29");
});

test("current closure status is independent of approval date; corrected dates do not change baseline", () => {
  const row = { plannedDate: "2026-10-04", correctedPlannedDate: "2026-10-15", actualDate: "2026-10-04", workflowStatus: "closed", actApprovedAt: "2026-10-04T22:00:00Z" };
  const today = getDeliveryProgress([row], "2026-10", "2026-10-04");
  assert.equal(today.periodPlan, 0);
  assert.equal(today.todayPlan, 1);
  assert.equal(today.done, 1);
  assert.equal(today.closed, 1);
  assert.equal(today.todayClosed, 1);
  assert.equal(getDeliveryProgress([row], "2026-10", "2026-10-05").closed, 1);
});

test("first day has an empty prior period but includes today's deliveries in monthly totals", () => {
  const summary = getDeliveryProgress([{
    plannedDate: "2027-01-01", actualDate: "2027-01-01",
    workflowStatus: "closed", actApprovedAt: "2026-12-31T21:30:00Z",
  }], "2027-01", "2027-01-01");
  assert.equal(summary.started, false);
  assert.equal(summary.through, "2026-12-31");
  assert.equal(summary.periodFact, 0);
  assert.equal(summary.periodClosed, 0);
  assert.equal(summary.done, 1);
  assert.equal(summary.closed, 1);
  assert.equal(summary.todayFact, 1);
  assert.equal(summary.todayClosed, 1);
});

test("past and future months have no today counters; month end and leap day are respected", () => {
  for (const month of ["2026-09", "2026-11"]) {
    const summary = getDeliveryProgress(rows, month, "2026-10-04");
    assert.equal(summary.todayActive, false);
    assert.equal(summary.todayPlan + summary.todayFact + summary.todayClosed, 0);
  }
  const summary = getDeliveryProgress([{
    plannedDate: "2028-02-29", actualDate: "2028-02-29",
    workflowStatus: "closed", actApprovedAt: "2028-03-01T01:00:00Z",
  }], "2028-02", "2028-03-01");
  assert.equal(summary.through, "2028-02-29");
  assert.equal(summary.periodPlan, 1);
  assert.equal(summary.periodFact, 1);
  assert.equal(summary.periodClosed, 1);
  assert.equal(summary.closed, 1);
});

test("approving an October 2 delivery on October 7 updates the October 1–6 period without changing completed or plan", () => {
  const delivery = { plannedDate: "2026-10-02", actualDate: "2026-10-02", workflowStatus: "done", actApprovedAt: null };
  const before = getDeliveryProgress([delivery], "2026-10", "2026-10-07");
  const after = getDeliveryProgress([{ ...delivery, workflowStatus: "closed", actApprovedAt: "2026-10-07T10:00:00Z" }], "2026-10", "2026-10-07");
  assert.equal(before.periodClosed, 0);
  assert.equal(after.periodClosed, 1);
  assert.equal(after.closed, 1);
  assert.equal(after.todayClosed, 0);
  assert.equal(after.periodFact, before.periodFact);
  assert.equal(after.periodPlan, before.periodPlan);
  assert.equal(after.done, before.done);
  assert.equal(deliveryProgressPercent(after.periodClosed, after.periodPlan), "100%");
  assert.equal(getDeliveryProgress([delivery], "2026-10", "2026-10-07").periodClosed, 0);
});