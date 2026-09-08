import assert from "node:assert/strict";
import test from "node:test";

import {
  getDeliveryUploadCleanupConfig,
  createDeliveryUploadCleanupCoordinator,
  runLiveDeliveryUploadCleanup,
  startDeliveryUploadCleanupScheduler,
  type CleanupLogger,
  type DeliveryUploadCleanupSummary,
} from "./delivery-upload-cleanup.ts";
import {
  AutomaticCleanupStatusRecordingError,
  createAutomaticCleanupRunRecorder,
  createAutomaticCleanupStatusWriter,
  type AutomaticCleanupStatusRow,
  type AutomaticCleanupStatusUpsert,
  type AutomaticCleanupStatusWrite,
} from "./delivery-upload-cleanup-status.ts";

const loggerEvents: Array<{ level: string; bindings: Record<string, unknown> }> = [];
const logger: CleanupLogger = {
  info: (bindings) => loggerEvents.push({ level: "info", bindings }),
  debug: (bindings) => loggerEvents.push({ level: "debug", bindings }),
  error: (bindings) => loggerEvents.push({ level: "error", bindings }),
};

test("cleanup configuration has safe defaults and rejects invalid explicit values", () => {
  assert.deepEqual(getDeliveryUploadCleanupConfig({}), {
    retentionHours: 24,
    intervalHours: 6,
    initialDelaySeconds: 60,
  });
  assert.deepEqual(getDeliveryUploadCleanupConfig({
    DELIVERY_UPLOAD_RETENTION_HOURS: "48",
    DELIVERY_UPLOAD_CLEANUP_INTERVAL_HOURS: "12",
    DELIVERY_UPLOAD_CLEANUP_INITIAL_DELAY_SECONDS: "5",
  }), { retentionHours: 48, intervalHours: 12, initialDelaySeconds: 5 });
  for (const name of [
    "DELIVERY_UPLOAD_RETENTION_HOURS",
    "DELIVERY_UPLOAD_CLEANUP_INTERVAL_HOURS",
    "DELIVERY_UPLOAD_CLEANUP_INITIAL_DELAY_SECONDS",
  ]) {
    for (const value of ["", "0", "-1", "1.5", "NaN"]) {
      assert.throws(() => getDeliveryUploadCleanupConfig({ [name]: value }), new RegExp(name));
    }
  }
});

test("due coordinator shares concurrent catch-up callers and skips calls before due", async () => {
  let clock = 0;
  let runs = 0;
  let resolveRun: (() => void) | undefined;
  const coordinator = createDeliveryUploadCleanupCoordinator(
    { retentionHours: 24, intervalHours: 6, initialDelaySeconds: 60 },
    {
      runCleanup: () => {
        runs += 1;
        if (runs > 1) return Promise.resolve();
        return new Promise<void>((resolve) => { resolveRun = resolve; });
      },
      logger,
    },
    () => clock,
  );
  const first = coordinator.runIfDue();
  const second = coordinator.runIfDue();
  assert.strictEqual(first, second);
  assert.equal(runs, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);
  resolveRun!();
  await first;
  await coordinator.runIfDue();
  assert.equal(runs, 1);
  clock += 6 * 60 * 60 * 1000;
  await coordinator.runIfDue();
  assert.equal(runs, 2);
});

test("due coordinator logs failures and retries without rejecting callers", async () => {
  let clock = 0;
  let runs = 0;
  const errorsBefore = loggerEvents.filter((event) => event.level === "error").length;
  const coordinator = createDeliveryUploadCleanupCoordinator(
    { retentionHours: 24, intervalHours: 6, initialDelaySeconds: 60 },
    {
      runCleanup: async () => {
        runs += 1;
        if (runs === 1) throw new Error("temporary failure");
      },
      logger,
    },
    () => clock,
  );
  await coordinator.runIfDue();
  assert.equal(runs, 1);
  assert.equal(loggerEvents.filter((event) => event.level === "error").length, errorsBefore + 1);
  await coordinator.runIfDue();
  assert.equal(runs, 1);
  clock += 60_000;
  await coordinator.runIfDue();
  assert.equal(runs, 2);
});

test("scheduler executes after initial delay and recursively schedules after completion", async () => {
  const timers: Array<{ callback: () => void; delay: number; unref: () => void }> = [];
  let runs = 0;
  const scheduler = startDeliveryUploadCleanupScheduler(
    { retentionHours: 24, intervalHours: 6, initialDelaySeconds: 60 },
    {
      runCleanup: async () => { runs += 1; },
      logger,
      setTimeout: (callback, delay) => {
        const timer = { callback, delay, unref: () => {} };
        timers.push(timer);
        return timer;
      },
      clearTimeout: () => {},
    },
  );
  assert.equal(timers[0]?.delay, 60_000);
  timers[0]!.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);
  assert.equal(timers[1]?.delay, 6 * 60 * 60 * 1000);
  scheduler.stop();
});

test("scheduler does not queue a recurring run until the current run resolves", async () => {
  const timers: Array<{ callback: () => void; delay: number; unref: () => void }> = [];
  let resolveRun: (() => void) | undefined;
  const scheduler = startDeliveryUploadCleanupScheduler(
    { retentionHours: 24, intervalHours: 6, initialDelaySeconds: 1 },
    {
      runCleanup: () => new Promise<void>((resolve) => { resolveRun = resolve; }),
      logger,
      setTimeout: (callback, delay) => {
        const timer = { callback, delay, unref: () => {} };
        timers.push(timer);
        return timer;
      },
      clearTimeout: () => {},
    },
  );
  timers[0]!.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.length, 1);
  resolveRun!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.length, 2);
  assert.equal(timers[1]?.delay, 6 * 60 * 60 * 1000);
  scheduler.stop();
});

test("live cleanup skips deletion when the global advisory lock is unavailable", async () => {
  let listed = false;
  let deleted = false;
  const summary = await runLiveDeliveryUploadCleanup({
    db: {
      transaction: async (callback) => callback({
        execute: async () => ({ rows: [{ acquired: false }] }),
      }),
    },
    runWithGlobalCleanupLock: async () => null,
    listUploads: async () => {
      listed = true;
      return [{ objectPath: "/objects/uploads/old", createdAt: new Date(0) }];
    },
    listReferencedObjectPaths: async () => [],
    isObjectPathReferenced: async () => false,
    deleteObject: async () => { deleted = true; return true; },
    logger,
  });
  assert.equal(summary, null);
  assert.equal(listed, false);
  assert.equal(deleted, false);
});

test("live cleanup is automatic delete mode and continues after an object failure", async () => {
  const deleted: string[] = [];
  let executions = 0;
  const summary = await runLiveDeliveryUploadCleanup({
    db: {
      transaction: async (callback) => callback({
        execute: async () => {
          executions += 1;
          return executions === 1 ? { rows: [{ acquired: true }] } : { rows: [] };
        },
      }),
    },
    runWithGlobalCleanupLock: async (callback) =>
      callback({
        transaction: async (transactionCallback: (transaction: any) => Promise<unknown>) =>
          transactionCallback({
            execute: async () => {
              executions += 1;
              return { rows: [] };
            },
          }),
      }),
    listUploads: async () => [
      { objectPath: "/objects/uploads/fails", createdAt: new Date(0) },
      { objectPath: "/objects/uploads/works", createdAt: new Date(0) },
    ],
    listReferencedObjectPaths: async () => [],
    isObjectPathReferenced: async () => false,
    deleteObject: async (path) => {
      if (path.endsWith("fails")) throw new Error("storage unavailable");
      deleted.push(path);
      return true;
    },
    logger,
  });
  assert.equal(summary?.failed, 1);
  assert.equal(summary?.deleted, 1);
  assert.deepEqual(deleted, ["/objects/uploads/works"]);
  assert.ok(loggerEvents.some((event) => event.level === "error"));
});

test("live cleanup never deletes an old object referenced during its exact recheck", async () => {
  let deleted = false;
  let executions = 0;
  const summary = await runLiveDeliveryUploadCleanup({
    db: {
      transaction: async (callback) => callback({
        execute: async () => {
          executions += 1;
          return executions === 1 ? { rows: [{ acquired: true }] } : { rows: [] };
        },
      }),
    },
    runWithGlobalCleanupLock: async (callback) =>
      callback({
        transaction: async (transactionCallback: (transaction: any) => Promise<unknown>) =>
          transactionCallback({
            execute: async () => {
              executions += 1;
              return { rows: [] };
            },
          }),
      }),
    listUploads: async () => [{ objectPath: "/objects/uploads/referenced", createdAt: new Date(0) }],
    listReferencedObjectPaths: async () => [],
    isObjectPathReferenced: async () => true,
    deleteObject: async () => { deleted = true; return true; },
    logger,
  });
  assert.equal(summary?.raceSkipped, 1);
  assert.equal(summary?.deleted, 0);
  assert.equal(deleted, false);
});

test("automatic cleanup lock skip does not overwrite the previous status", async () => {
  const previousSuccessfulRunAt = new Date("2026-09-01T06:00:00.000Z");
  const previousStatus: AutomaticCleanupStatusRow = {
    key: "automatic",
    lastRunAt: previousSuccessfulRunAt,
    lastSuccessfulRunAt: previousSuccessfulRunAt,
    status: "success",
    scanned: 12,
    candidates: 2,
    deleted: 2,
    resumedPhotoDeletions: 0,
    resumedDeliveryDeletions: 0,
    failed: 0,
    updatedAt: previousSuccessfulRunAt,
  };
  let persisted = { ...previousStatus };
  let writeCalls = 0;

  const recordSkippedRun = createAutomaticCleanupRunRecorder({
    now: () => new Date("2026-09-08T06:00:00.000Z"),
    runCleanup: async () => null,
    writeStatus: async () => {
      writeCalls += 1;
      persisted = {
        ...persisted,
        lastRunAt: new Date("2026-09-08T06:00:00.000Z"),
        updatedAt: new Date("2026-09-08T06:00:00.000Z"),
      };
    },
  });

  await recordSkippedRun();

  assert.equal(writeCalls, 0);
  assert.deepEqual(persisted, previousStatus);
  assert.equal(persisted.lastSuccessfulRunAt, previousSuccessfulRunAt);
});

test("automatic cleanup status keeps the last success after partial and total failures", async () => {
  const successfulRunAt = new Date("2026-09-01T06:00:00.000Z");
  const partialFailureRunAt = new Date("2026-09-02T06:00:00.000Z");
  const totalFailureRunAt = new Date("2026-09-03T06:00:00.000Z");
  const runTimes = [
    successfulRunAt,
    partialFailureRunAt,
    totalFailureRunAt,
  ];
  const successfulSummary: DeliveryUploadCleanupSummary = {
    scanned: 8,
    referenced: 5,
    tooYoung: 0,
    unknownAge: 0,
    candidates: 3,
    deleted: 3,
    resumedPhotoDeletions: 1,
    resumedDeliveryDeletions: 1,
    raceSkipped: 0,
    failed: 0,
    failures: [],
  };
  const partialFailureSummary: DeliveryUploadCleanupSummary = {
    scanned: 7,
    referenced: 4,
    tooYoung: 0,
    unknownAge: 0,
    candidates: 3,
    deleted: 2,
    resumedPhotoDeletions: 1,
    resumedDeliveryDeletions: 0,
    raceSkipped: 0,
    failed: 1,
    failures: [
      {
        objectPath: "/objects/uploads/private-customer-document.pdf",
        error: "storage rejected the delete request",
      },
    ],
  };
  const outcomes: Array<DeliveryUploadCleanupSummary | Error> = [
    successfulSummary,
    partialFailureSummary,
    new Error("storage listing failed for /objects/uploads"),
  ];
  const writes: AutomaticCleanupStatusWrite[] = [];
  const upserts: AutomaticCleanupStatusUpsert[] = [];
  let persisted: AutomaticCleanupStatusRow | undefined;
  const writeStatus = createAutomaticCleanupStatusWriter(async (upsert) => {
    upserts.push(upsert);
    persisted = persisted
      ? { ...persisted, ...upsert.update }
      : upsert.insert;
  });

  const recordRun = createAutomaticCleanupRunRecorder({
    now: () => runTimes.shift()!,
    runCleanup: async () => {
      const outcome = outcomes.shift()!;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    writeStatus: async (write) => {
      writes.push(write);
      await writeStatus(write);
    },
  });

  await recordRun();
  assert.equal(persisted?.lastSuccessfulRunAt, successfulRunAt);
  assert.deepEqual(persisted, {
    key: "automatic",
    lastRunAt: successfulRunAt,
    lastSuccessfulRunAt: successfulRunAt,
    status: "success",
    scanned: 8,
    candidates: 3,
    deleted: 3,
    resumedPhotoDeletions: 1,
    resumedDeliveryDeletions: 1,
    failed: 0,
    updatedAt: successfulRunAt,
  });

  await recordRun();
  assert.deepEqual(persisted, {
    key: "automatic",
    lastRunAt: partialFailureRunAt,
    lastSuccessfulRunAt: successfulRunAt,
    status: "failed",
    scanned: 7,
    candidates: 3,
    deleted: 2,
    resumedPhotoDeletions: 1,
    resumedDeliveryDeletions: 0,
    failed: 1,
    updatedAt: partialFailureRunAt,
  });

  await assert.rejects(recordRun(), /storage listing failed/);
  assert.deepEqual(persisted, {
    key: "automatic",
    lastRunAt: totalFailureRunAt,
    lastSuccessfulRunAt: successfulRunAt,
    status: "failed",
    scanned: 0,
    candidates: 0,
    deleted: 0,
    resumedPhotoDeletions: 0,
    resumedDeliveryDeletions: 0,
    failed: 1,
    updatedAt: totalFailureRunAt,
  });

  assert.deepEqual(
    writes.map((write) => Object.keys(write.summary).sort()),
    [
      [
        "candidates",
        "deleted",
        "failed",
        "resumedDeliveryDeletions",
        "resumedPhotoDeletions",
        "scanned",
      ],
      [
        "candidates",
        "deleted",
        "failed",
        "resumedDeliveryDeletions",
        "resumedPhotoDeletions",
        "scanned",
      ],
      [
        "candidates",
        "deleted",
        "failed",
        "resumedDeliveryDeletions",
        "resumedPhotoDeletions",
        "scanned",
      ],
    ],
  );
  const persistedJson = JSON.stringify(writes);
  assert.doesNotMatch(persistedJson, /objects\/uploads/);
  assert.doesNotMatch(persistedJson, /storage rejected|storage listing failed/);
  assert.deepEqual(
    upserts.map(({ insert, update }) => ({
      insert: Object.keys(insert).sort(),
      update: Object.keys(update).sort(),
    })),
    [
      {
        insert: [
          "candidates",
          "deleted",
          "failed",
          "key",
          "lastRunAt",
          "lastSuccessfulRunAt",
          "resumedDeliveryDeletions",
          "resumedPhotoDeletions",
          "scanned",
          "status",
          "updatedAt",
        ],
        update: [
          "candidates",
          "deleted",
          "failed",
          "lastRunAt",
          "lastSuccessfulRunAt",
          "resumedDeliveryDeletions",
          "resumedPhotoDeletions",
          "scanned",
          "status",
          "updatedAt",
        ],
      },
      {
        insert: [
          "candidates",
          "deleted",
          "failed",
          "key",
          "lastRunAt",
          "lastSuccessfulRunAt",
          "resumedDeliveryDeletions",
          "resumedPhotoDeletions",
          "scanned",
          "status",
          "updatedAt",
        ],
        update: [
          "candidates",
          "deleted",
          "failed",
          "lastRunAt",
          "resumedDeliveryDeletions",
          "resumedPhotoDeletions",
          "scanned",
          "status",
          "updatedAt",
        ],
      },
      {
        insert: [
          "candidates",
          "deleted",
          "failed",
          "key",
          "lastRunAt",
          "lastSuccessfulRunAt",
          "resumedDeliveryDeletions",
          "resumedPhotoDeletions",
          "scanned",
          "status",
          "updatedAt",
        ],
        update: [
          "candidates",
          "deleted",
          "failed",
          "lastRunAt",
          "resumedDeliveryDeletions",
          "resumedPhotoDeletions",
          "scanned",
          "status",
          "updatedAt",
        ],
      },
    ],
  );
});

test("automatic cleanup preserves both errors when failed status cannot be written", async () => {
  const cleanupError = new Error("storage listing failed");
  const statusWriteError = new Error("cleanup status database write failed");
  let writeCalls = 0;
  const recordRun = createAutomaticCleanupRunRecorder({
    runCleanup: async () => {
      throw cleanupError;
    },
    writeStatus: async () => {
      writeCalls += 1;
      throw statusWriteError;
    },
  });

  await assert.rejects(recordRun(), (error) => {
    assert.ok(error instanceof AutomaticCleanupStatusRecordingError);
    assert.strictEqual(error.cause, cleanupError);
    assert.strictEqual(error.statusWriteError, statusWriteError);
    return true;
  });
  assert.equal(writeCalls, 1);
});