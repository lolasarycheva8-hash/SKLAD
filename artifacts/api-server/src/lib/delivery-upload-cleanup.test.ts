import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";

import {
  createProductionDeliveryUploadCleanupDependencies,
  DeliveryUploadStorageFinalizationTimeoutError,
  DeliveryUploadStorageListTimeoutError,
  finalizeDeliveryUploadStorageObject,
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

function createGlobalCleanupLockHarness(
  query: (
    text: string,
  ) => Promise<{ rows: Array<{ acquired?: boolean; released?: boolean }> }>,
) {
  const releases: Array<Error | boolean | undefined> = [];
  const client = {
    query: (text: string) => query(text),
    release: (error?: Error | boolean) => {
      releases.push(error);
    },
  };
  const dependencies = createProductionDeliveryUploadCleanupDependencies(
    {
      transaction: async (callback) => callback({}),
      $client: { connect: async () => client },
    },
    {},
    {},
    {
      listPrivateUploadObjects: async () => [],
      deleteObjectEntity: async () => true,
    },
    logger,
  );
  return { runWithGlobalCleanupLock: dependencies.runWithGlobalCleanupLock, releases };
}

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

test("global cleanup lock releases a healthy client exactly once", async () => {
  const queries: string[] = [];
  const harness = createGlobalCleanupLockHarness(async (text) => {
    queries.push(text);
    return text.includes("pg_try_advisory_lock")
      ? { rows: [{ acquired: true }] }
      : { rows: [{ released: true }] };
  });

  assert.equal(await harness.runWithGlobalCleanupLock(async () => "done"), "done");
  assert.equal(queries.length, 2);
  assert.deepEqual(harness.releases, [undefined]);
});

test("global cleanup lock releases a client exactly once when try-lock loses", async () => {
  const harness = createGlobalCleanupLockHarness(async () => ({
    rows: [{ acquired: false }],
  }));

  assert.equal(await harness.runWithGlobalCleanupLock(async () => "unreachable"), null);
  assert.deepEqual(harness.releases, [undefined]);
});

test("global cleanup lock still unlocks and releases once after a callback error", async () => {
  const callbackError = new Error("cleanup callback failed");
  let unlockCalls = 0;
  const harness = createGlobalCleanupLockHarness(async (text) => {
    if (text.includes("pg_advisory_unlock")) unlockCalls += 1;
    return text.includes("pg_try_advisory_lock")
      ? { rows: [{ acquired: true }] }
      : { rows: [{ released: true }] };
  });

  await assert.rejects(
    harness.runWithGlobalCleanupLock(async () => {
      throw callbackError;
    }),
    (error) => error === callbackError,
  );
  assert.equal(unlockCalls, 1);
  assert.deepEqual(harness.releases, [undefined]);
});

test("storage listing timeout aborts the request, records failure, releases the lock, and retries", async () => {
  let lockHeld = false;
  let unlockCalls = 0;
  let releaseCalls = 0;
  let listCalls = 0;
  let referenceListCalls = 0;
  let deleteCalls = 0;
  let firstListSignal: AbortSignal | undefined;
  const client = {
    query: async (text: string) => {
      if (text.includes("pg_try_advisory_lock")) {
        assert.equal(lockHeld, false);
        lockHeld = true;
        return { rows: [{ acquired: true }] };
      }
      assert.match(text, /pg_advisory_unlock/);
      assert.equal(lockHeld, true);
      lockHeld = false;
      unlockCalls += 1;
      return { rows: [{ released: true }] };
    },
    release: () => {
      releaseCalls += 1;
    },
  };
  const dependencies = createProductionDeliveryUploadCleanupDependencies(
    {
      transaction: async (callback) => callback({}),
      $client: { connect: async () => client },
    },
    {},
    {},
    {
      listPrivateUploadObjects: (signal) => {
        listCalls += 1;
        if (listCalls <= 2) {
          if (listCalls === 1) firstListSignal = signal;
          return new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(new DOMException("Storage listing aborted", "AbortError"));
            }, { once: true });
          });
        }
        return Promise.resolve([]);
      },
      deleteObjectEntity: async () => {
        deleteCalls += 1;
        return true;
      },
    },
    logger,
    30_000,
    5,
  );
  dependencies.resumePendingDeletions = undefined;
  dependencies.listReferencedObjectPaths = async () => {
    referenceListCalls += 1;
    return [];
  };

  const writes: AutomaticCleanupStatusWrite[] = [];
  let consecutiveFailures = 0;
  let hasPersistedStatus = false;
  const writeStatus = createAutomaticCleanupStatusWriter(async (upsert) => {
    if (!hasPersistedStatus) {
      consecutiveFailures = upsert.insert.consecutiveFailures;
      hasPersistedStatus = true;
      return;
    }
    consecutiveFailures =
      typeof upsert.update.consecutiveFailures === "number"
        ? upsert.update.consecutiveFailures
        : consecutiveFailures + 1;
  });
  const recordRun = createAutomaticCleanupRunRecorder({
    runCleanup: () => runLiveDeliveryUploadCleanup(dependencies),
    writeStatus: async (write) => {
      writes.push(write);
      await writeStatus(write);
    },
  });

  await assert.rejects(
    recordRun(),
    (error) => error instanceof DeliveryUploadStorageListTimeoutError,
  );
  assert.equal(lockHeld, false);
  assert.equal(unlockCalls, 1);
  assert.equal(releaseCalls, 1);
  assert.equal(writes[0]?.status, "failed");
  assert.equal(writes[0]?.failureKind, "list_timeout");
  assert.equal(consecutiveFailures, 1);
  assert.equal(writes[0]?.summary.failed, 1);
  assert.equal(referenceListCalls, 0);
  assert.equal(deleteCalls, 0);
  assert.equal(firstListSignal?.aborted, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(referenceListCalls, 0);
  assert.equal(deleteCalls, 0);

  await assert.rejects(
    recordRun(),
    (error) => error instanceof DeliveryUploadStorageListTimeoutError,
  );
  assert.equal(writes[1]?.failureKind, "list_timeout");
  assert.equal(consecutiveFailures, 2);
  assert.equal(listCalls, 2);
  assert.equal(lockHeld, false);
  assert.equal(unlockCalls, 2);
  assert.equal(releaseCalls, 2);

  await recordRun();
  assert.equal(listCalls, 3);
  assert.equal(lockHeld, false);
  assert.equal(unlockCalls, 3);
  assert.equal(releaseCalls, 3);
  assert.equal(writes[2]?.status, "success");
  assert.equal(writes[2]?.failureKind, "none");
  assert.equal(consecutiveFailures, 0);
});

test("storage finalization timeout aborts deletion safely and allows a clean retry", async () => {
  const privateObjectPath =
    "/objects/uploads/customer-secret-finalization-document.pdf";
  let calls = 0;
  let firstSignal: AbortSignal | undefined;
  let firstRequestSettled = false;
  const deleteObject = (
    objectPath: string,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    calls += 1;
    assert.equal(objectPath, privateObjectPath);
    if (calls === 2) return Promise.resolve(true);
    firstSignal = signal;
    return new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        firstRequestSettled = true;
        reject(new DOMException("Storage deletion aborted", "AbortError"));
      }, { once: true });
    });
  };

  await assert.rejects(
    finalizeDeliveryUploadStorageObject(
      deleteObject,
      privateObjectPath,
      5,
    ),
    (error) => {
      assert.ok(
        error instanceof DeliveryUploadStorageFinalizationTimeoutError,
      );
      assert.doesNotMatch(error.message, /customer-secret|objects\/uploads/);
      return true;
    },
  );
  assert.equal(firstSignal?.aborted, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(firstRequestSettled, true);

  assert.equal(
    await finalizeDeliveryUploadStorageObject(
      deleteObject,
      privateObjectPath,
      50,
    ),
    true,
  );
  assert.equal(calls, 2);
});

test("global cleanup lock destroys the client when PostgreSQL does not confirm unlock", async () => {
  const harness = createGlobalCleanupLockHarness(async (text) =>
    text.includes("pg_try_advisory_lock")
      ? { rows: [{ acquired: true }] }
      : { rows: [{ released: false }] },
  );

  await assert.rejects(
    harness.runWithGlobalCleanupLock(async () => "done"),
    /session lock was not held/,
  );
  assert.equal(harness.releases.length, 1);
  assert.ok(harness.releases[0] instanceof Error);
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

test("live cleanup production logs keep storage failure reasons without private paths", async () => {
  const previousNodeEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const { createLogger } = await import("./logger.ts");
  process.env.NODE_ENV = previousNodeEnvironment;
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  const actualLogger = createLogger(
    {
      NODE_ENV: "production",
      LOG_LEVEL: "debug",
      PRIVATE_OBJECT_DIR: "/private-bucket/customer-files",
    },
    destination,
  );
  const privateObjectPath =
    "/objects/uploads/customer's report: final (signed).pdf";
  let executions = 0;
  const previousPrivateObjectDir = process.env.PRIVATE_OBJECT_DIR;
  process.env.PRIVATE_OBJECT_DIR = "/private-bucket/customer-files";

  const summary = await runLiveDeliveryUploadCleanup({
      db: {
        transaction: async (callback) =>
          callback({
            execute: async () => {
              executions += 1;
              return executions === 1
                ? { rows: [{ acquired: true }] }
                : { rows: [] };
            },
          }),
      },
      runWithGlobalCleanupLock: async (callback) =>
        callback({
          transaction: async (
            transactionCallback: (transaction: any) => Promise<unknown>,
          ) =>
            transactionCallback({
              execute: async () => {
                executions += 1;
                return { rows: [] };
              },
            }),
        }),
      listUploads: async () => [
        { objectPath: privateObjectPath, createdAt: new Date(0) },
      ],
      listReferencedObjectPaths: async () => [],
      isObjectPathReferenced: async () => false,
      deleteObject: async () => {
        throw new Error(
        `access denied while deleting https://storage.googleapis.com/private-bucket/customer-files/uploads/customer's report: final (signed).pdf`,
        );
      },
      logger: actualLogger,
    }).finally(() => {
      if (previousPrivateObjectDir === undefined) {
        delete process.env.PRIVATE_OBJECT_DIR;
      } else {
        process.env.PRIVATE_OBJECT_DIR = previousPrivateObjectDir;
      }
    });

  assert.equal(summary?.failed, 1);
  const output = lines.join("");
  assert.match(output, /access denied while deleting/);
  assert.match(output, /\[PRIVATE_OBJECT_PATH\]/);
  assert.doesNotMatch(
    output,
    /customer's|final \(signed\)|private-bucket|customer-files/,
  );
});

test("production logs redact percent-encoded private upload paths without hiding the Storage error", async () => {
  const previousNodeEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const { createLogger } = await import("./logger.ts");
  process.env.NODE_ENV = previousNodeEnvironment;
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  const actualLogger = createLogger(
    {
      NODE_ENV: "production",
      LOG_LEVEL: "error",
      PRIVATE_OBJECT_DIR: "/private-bucket/customer-files",
    },
    destination,
  );
  const encodedPrivatePaths = [
    "https://storage.googleapis.com/private-bucket/customer-files/uploads%2Fcustomer-secret-contract.pdf",
    "https://storage.googleapis.com/private-bucket/customer-files%2Fuploads%2Fcustomer-secret-contract.pdf",
    "/objects%2Fuploads%2Fcustomer-secret-contract.pdf",
    "%2Fobjects%2Fuploads%2Fcustomer-secret-contract.pdf",
    "/objects%2fuploads%2fcustomer-secret-contract.pdf",
  ];

  encodedPrivatePaths.forEach((encodedPrivatePath, index) => {
    actualLogger.error(
      {
        err: new Error(
          `StorageError code 403 case ${index + 1}: access denied while deleting ${encodedPrivatePath}`,
        ),
      },
      "Delivery upload cleanup failed",
    );
  });

  assert.equal(lines.length, encodedPrivatePaths.length);
  lines.forEach((output, index) => {
    const entry = JSON.parse(output);
    assert.equal(
      entry.err.message,
      `StorageError code 403 case ${index + 1}: access denied while deleting [PRIVATE_OBJECT_PATH]`,
    );
    assert.match(entry.err.stack, /\[PRIVATE_OBJECT_PATH\]/);
    assert.doesNotMatch(
      output,
      /customer-secret-contract|private-bucket|customer-files|uploads%2f/i,
    );
  });
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
    failureKind: "none",
    consecutiveFailures: 0,
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
    if (persisted) {
      const previousConsecutiveFailures = persisted.consecutiveFailures;
      persisted = {
        ...persisted,
        ...upsert.update,
        consecutiveFailures:
          typeof upsert.update.consecutiveFailures === "number"
            ? upsert.update.consecutiveFailures
            : previousConsecutiveFailures + 1,
      };
    } else {
      persisted = upsert.insert;
    }
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
    failureKind: "none",
    consecutiveFailures: 0,
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
    failureKind: "other",
    consecutiveFailures: 1,
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
    failureKind: "other",
    consecutiveFailures: 2,
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
    writes.map(({ status, failureKind }) => ({ status, failureKind })),
    [
      { status: "success", failureKind: "none" },
      { status: "failed", failureKind: "other" },
      { status: "failed", failureKind: "other" },
    ],
  );
  assert.equal(upserts.length, 3);
  for (const { insert, update } of upserts) {
    assert.ok("failureKind" in insert);
    assert.ok("consecutiveFailures" in insert);
    assert.ok("failureKind" in update);
    assert.ok("consecutiveFailures" in update);
  }
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

test("coordinator logs both cleanup failures once through the production Pino serializer without private status data", async () => {
  const previousNodeEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const { createLogger } = await import("./logger.ts");
  process.env.NODE_ENV = previousNodeEnvironment;
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  const actualLogger = createLogger(
    {
      NODE_ENV: "production",
      LOG_LEVEL: "error",
      PRIVATE_OBJECT_DIR: "/private-bucket/customer-files",
    },
    destination,
  );
  const privateObjectPath =
    "/objects/uploads/customer's report: final (signed).pdf";
  const physicalPrivateObjectPath =
    "https://storage.googleapis.com/private-bucket/customer-files/uploads/customer's report: final (signed).pdf";
  const cleanupError = Object.assign(
    new Error(`access denied while deleting ${privateObjectPath}`),
    { objectPath: privateObjectPath },
  );
  const statusWriteError = Object.assign(
    new Error(
      `cleanup status database write failed after ${physicalPrivateObjectPath}: connection closed`,
    ),
    { objectPath: privateObjectPath },
  );
  const recordRun = createAutomaticCleanupRunRecorder({
    runCleanup: async () => {
      throw cleanupError;
    },
    writeStatus: async () => {
      throw statusWriteError;
    },
  });
  const coordinator = createDeliveryUploadCleanupCoordinator(
    { retentionHours: 24, intervalHours: 6, initialDelaySeconds: 60 },
    { runCleanup: recordRun, logger: actualLogger },
    () => 0,
  );

  await coordinator.runIfDue();

  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]!);
  assert.match(
    entry.err.message,
    /^Cleanup failed and its failed status could not be recorded/,
  );
  assert.equal(
    entry.err.cause.message,
    "access denied while deleting [PRIVATE_OBJECT_PATH]",
  );
  assert.equal(
    entry.err.statusWriteError.message,
    "cleanup status database write failed after [PRIVATE_OBJECT_PATH]",
  );
  assert.match(entry.err.cause.stack, /access denied while deleting/);
  assert.match(
    entry.err.statusWriteError.stack,
    /cleanup status database write failed/,
  );
  assert.doesNotMatch(
    lines[0]!,
    /customer's|final \(signed\)|private-bucket|customer-files/,
  );
});

test("production logger preserves the root error when cause references itself", async () => {
  const previousNodeEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const { createLogger } = await import("./logger.ts");
  process.env.NODE_ENV = previousNodeEnvironment;
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  const actualLogger = createLogger(
    { NODE_ENV: "production", LOG_LEVEL: "error" },
    destination,
  );
  const cyclicError = new Error("корневая ошибка очистки");
  cyclicError.cause = cyclicError;

  assert.doesNotThrow(() => {
    actualLogger.error({ err: cyclicError }, "cleanup failed");
  });

  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]!);
  assert.equal(entry.err.message, "корневая ошибка очистки");
  assert.deepEqual(entry.err.cause, {
    type: "RepeatedErrorReference",
    message: "Повторная ссылка на уже записанную ошибку опущена",
  });
});

test("production logger sanitizes a private path in a string-valued cause", async () => {
  const previousNodeEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const { createLogger } = await import("./logger.ts");
  process.env.NODE_ENV = previousNodeEnvironment;
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  const actualLogger = createLogger(
    { NODE_ENV: "production", LOG_LEVEL: "error" },
    destination,
  );
  const error = new Error("cleanup failed", {
    cause:
      "code 403 while deleting /objects/uploads/customer's report: final (signed).pdf",
  });

  actualLogger.error({ err: error }, "cleanup failed");

  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]!);
  assert.equal(
    entry.err.cause.message,
    "code 403 while deleting [PRIVATE_OBJECT_PATH]",
  );
  assert.doesNotMatch(lines[0]!, /customer's|final \(signed\)/);
});
