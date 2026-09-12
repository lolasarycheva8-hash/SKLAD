import assert from "node:assert/strict";
import { test } from "node:test";

import { startBulkSiteImportSlowWindowCleanup } from "./bulk-site-import-slow-cleanup.ts";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for cleanup scheduler");
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

test("cleanup runs immediately and overlapping interval ticks are skipped", async () => {
  const firstRun = deferred();
  let calls = 0;
  const stop = startBulkSiteImportSlowWindowCleanup({
    cleanup: async () => {
      calls += 1;
      if (calls === 1) await firstRun.promise;
    },
    onError(error) {
      assert.fail(`unexpected cleanup error: ${String(error)}`);
    },
    intervalMs: 5,
  });

  try {
    await waitFor(() => calls === 1);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(calls, 1);

    firstRun.resolve();
    await waitFor(() => calls === 2);
  } finally {
    stop();
    firstRun.resolve();
  }
});

test("cleanup errors are reported and a later interval retries", async () => {
  const expectedError = new Error("expected cleanup failure");
  const errors: unknown[] = [];
  let calls = 0;
  const stop = startBulkSiteImportSlowWindowCleanup({
    cleanup: async () => {
      calls += 1;
      if (calls === 1) throw expectedError;
    },
    onError(error) {
      errors.push(error);
    },
    intervalMs: 5,
  });

  try {
    await waitFor(() => calls >= 2);
    assert.deepEqual(errors, [expectedError]);
  } finally {
    stop();
  }

  const callsWhenStopped = calls;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, callsWhenStopped);
});