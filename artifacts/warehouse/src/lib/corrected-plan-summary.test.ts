import assert from "node:assert/strict";
import test from "node:test";
import { hasCorrectedPlan, summarizeCorrectedPlans } from "./corrected-plan-summary.ts";

test("корректировки: количество и доля от строк с исходной плановой датой", () => {
  const rows = [
    { plannedDate: "2026-09-01", correctedPlannedDate: "2026-09-02" },
    { plannedDate: "2026-09-01", correctedPlannedDate: "2026-10-01" },
    { plannedDate: "2026-09-03", correctedPlannedDate: null },
    { plannedDate: "2026-09-04" },
    { plannedDate: null, correctedPlannedDate: null },
  ];
  assert.deepEqual(summarizeCorrectedPlans(rows), { count: 2, percent: 50 });
  assert.equal(rows.filter(hasCorrectedPlan).length, 2);
});

test("корректировки: пустой план и удалённая корректировка не дают NaN", () => {
  assert.deepEqual(summarizeCorrectedPlans([]), { count: 0, percent: 0 });
  assert.deepEqual(summarizeCorrectedPlans([{ plannedDate: null }]), { count: 0, percent: 0 });
  assert.deepEqual(summarizeCorrectedPlans([
    { plannedDate: "2026-09-01", correctedPlannedDate: null },
  ]), { count: 0, percent: 0 });
});