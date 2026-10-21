import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileDeliveryUploads,
  validateMinimumAgeHours,
  type DeliveryUploadObject,
} from "./reconcile-delivery-uploads.ts";

const now = new Date("2026-03-10T12:00:00.000Z");
const old = new Date("2026-03-08T00:00:00.000Z");
const young = new Date("2026-03-10T11:00:00.000Z");

function dependencies(
  uploads: DeliveryUploadObject[],
  referenced: string[] = [],
) {
  return {
    listUploads: async () => uploads,
    listReferencedObjectPaths: async () => referenced,
  };
}

test("reconciliation reports and preserves an old unregistered object", async () => {
  const deps = dependencies([{ objectPath: "/objects/uploads/old", createdAt: old }]);
  const summary = await reconcileDeliveryUploads(deps, { now });
  assert.equal(summary.candidates, 1);
  assert.equal(summary.preserved, 1);
  assert.equal(summary.deleted, 0);
});

test("referenced, young, threshold-equal, and unknown-age objects are skipped", async () => {
  const cutoff = new Date("2026-03-09T12:00:00.000Z");
  const deps = dependencies(
    [
      { objectPath: "/objects/uploads/referenced", createdAt: old },
      { objectPath: "/objects/uploads/young", createdAt: young },
      { objectPath: "/objects/uploads/equal", createdAt: cutoff },
      { objectPath: "/objects/uploads/unknown", createdAt: null },
      { objectPath: "/objects/uploads/invalid", createdAt: new Date("invalid") },
    ],
    ["/objects/uploads/referenced"],
  );
  const summary = await reconcileDeliveryUploads(deps, { now });
  assert.deepEqual(
    {
      referenced: summary.referenced,
      tooYoung: summary.tooYoung,
      unknownAge: summary.unknownAge,
      candidates: summary.candidates,
    },
    { referenced: 1, tooYoung: 2, unknownAge: 2, candidates: 0 },
  );
});

test("all old unregistered objects are preserved without a deletion callback", async () => {
  const deps = dependencies(
    [
      { objectPath: "/objects/uploads/dev-db-unregistered", createdAt: old },
      { objectPath: "/objects/uploads/prod-delivery-act", createdAt: old },
    ],
  );
  const summary = await reconcileDeliveryUploads(deps, { now });
  assert.equal(summary.candidates, 2);
  assert.equal(summary.preserved, 2);
  assert.equal(summary.deleted, 0);
  assert.equal(summary.failed, 0);
});

test("minimum age validation rejects unsafe thresholds", () => {
  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => validateMinimumAgeHours(value));
  }
  assert.equal(validateMinimumAgeHours(1), 1);
});