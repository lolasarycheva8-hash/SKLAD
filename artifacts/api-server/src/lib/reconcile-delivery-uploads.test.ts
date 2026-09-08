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
  overrides: {
    remove?: (path: string) => Promise<"deleted" | "raceSkipped">;
  } = {},
) {
  const deleted: string[] = [];
  return {
    deleted,
    value: {
      listUploads: async () => uploads,
      listReferencedObjectPaths: async () => referenced,
      deleteIfUnreferenced: overrides.remove ?? (async (path: string) => {
        deleted.push(path);
        return "deleted" as const;
      }),
    },
  };
}

test("dry run selects an old orphan but deletes nothing", async () => {
  const deps = dependencies([{ objectPath: "/objects/uploads/old", createdAt: old }]);
  const summary = await reconcileDeliveryUploads(deps.value, { now });
  assert.equal(summary.candidates, 1);
  assert.equal(summary.deleted, 0);
  assert.deepEqual(deps.deleted, []);
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
  const summary = await reconcileDeliveryUploads(deps.value, { now });
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

test("delete mode rechecks and deletes an old orphan", async () => {
  const deps = dependencies([{ objectPath: "/objects/uploads/old", createdAt: old }]);
  const summary = await reconcileDeliveryUploads(deps.value, { dryRun: false, now });
  assert.equal(summary.deleted, 1);
  assert.deepEqual(deps.deleted, ["/objects/uploads/old"]);
});

test("delete mode skips an object attached during reconciliation", async () => {
  const deps = dependencies(
    [{ objectPath: "/objects/uploads/race", createdAt: old }],
    [],
    { remove: async () => "raceSkipped" },
  );
  const summary = await reconcileDeliveryUploads(deps.value, { dryRun: false, now });
  assert.equal(summary.raceSkipped, 1);
  assert.equal(summary.deleted, 0);
});

test("individual delete failures are recorded and do not stop later deletes", async () => {
  const deleted: string[] = [];
  const deps = dependencies(
    [
      { objectPath: "/objects/uploads/fails", createdAt: old },
      { objectPath: "/objects/uploads/succeeds", createdAt: old },
    ],
    [],
    {
      remove: async (path) => {
        if (path.endsWith("/fails")) throw new Error("storage unavailable");
        deleted.push(path);
        return "deleted";
      },
    },
  );
  const summary = await reconcileDeliveryUploads(deps.value, { dryRun: false, now });
  assert.equal(summary.failed, 1);
  assert.equal(summary.deleted, 1);
  assert.deepEqual(summary.failures, [
    { objectPath: "/objects/uploads/fails", error: "storage unavailable" },
  ]);
  assert.deepEqual(deleted, ["/objects/uploads/succeeds"]);
});

test("delete decision is delegated as one coordinated operation per candidate", async () => {
  const decisions: string[] = [];
  const deps = dependencies(
    [
      { objectPath: "/objects/uploads/attached-during-run", createdAt: old },
      { objectPath: "/objects/uploads/still-orphaned", createdAt: old },
    ],
    [],
    {
      remove: async (path) => {
        decisions.push(path);
        return path.endsWith("attached-during-run") ? "raceSkipped" : "deleted";
      },
    },
  );
  const summary = await reconcileDeliveryUploads(deps.value, { dryRun: false, now });
  assert.deepEqual(decisions, [
    "/objects/uploads/attached-during-run",
    "/objects/uploads/still-orphaned",
  ]);
  assert.equal(summary.raceSkipped, 1);
  assert.equal(summary.deleted, 1);
});

test("minimum age validation rejects unsafe thresholds", () => {
  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => validateMinimumAgeHours(value));
  }
  assert.equal(validateMinimumAgeHours(1), 1);
});