import assert from "node:assert/strict";
import test from "node:test";

import {
  createOverdueDeliveryBuckets,
  matchesOverdueBucket,
} from "./overdue-delivery-buckets.ts";

test("распределяет просрочку по границам менее 3, 3–5 и более 5 дней", () => {
  assert.equal(matchesOverdueBucket(2, "overdue-under-3"), true);
  assert.equal(matchesOverdueBucket(3, "overdue-under-3"), false);
  assert.equal(matchesOverdueBucket(3, "overdue-3-to-5"), true);
  assert.equal(matchesOverdueBucket(5, "overdue-3-to-5"), true);
  assert.equal(matchesOverdueBucket(6, "overdue-over-5"), true);
  assert.equal(matchesOverdueBucket(0, "overdue-under-3"), false);
  assert.equal(matchesOverdueBucket(null, "overdue-over-5"), false);
});

test("считает количество и долю от плановых доставок", () => {
  const buckets = createOverdueDeliveryBuckets(
    [
      { lagDays: 1 },
      { lagDays: 2 },
      { lagDays: 3 },
      { lagDays: 5 },
      { lagDays: 6 },
      { lagDays: 9 },
      { lagDays: 0 },
      { lagDays: null },
    ],
    8,
  );

  assert.deepEqual(
    buckets.map(({ id, count, percent }) => ({
      id,
      count,
      percent: Number(percent.toFixed(1)),
    })),
    [
      { id: "overdue-under-3", count: 2, percent: 25 },
      { id: "overdue-3-to-5", count: 2, percent: 25 },
      { id: "overdue-over-5", count: 2, percent: 25 },
    ],
  );
});

test("возвращает нулевые проценты при нулевом плане", () => {
  assert.deepEqual(
    createOverdueDeliveryBuckets(
      [{ lagDays: 2 }, { lagDays: 4 }, { lagDays: 7 }],
      0,
    ).map(({ percent }) => ({ percent })),
    [
      { percent: 0 },
      { percent: 0 },
      { percent: 0 },
    ],
  );
});