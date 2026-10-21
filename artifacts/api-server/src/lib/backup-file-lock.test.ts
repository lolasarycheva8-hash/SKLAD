import assert from "node:assert/strict";
import { test } from "node:test";

import type pg from "pg";

import {
  withAbortableBackupFileDeletionBarrier,
  withBackupFileDeletionBarrier,
  withBackupFileReadBarrier,
} from "./backup-file-lock";

interface FakeClientState {
  queries: string[];
  queryTimeouts?: number[];
  releaseErrors: Array<Error | undefined>;
  acquireError?: Error;
  neverSettleAcquire?: boolean;
  neverSettleUnlock?: boolean;
  unlockResult?: boolean;
  unlockError?: Error;
}

function fakePool(state: FakeClientState): pg.Pool {
  const client = {
    async query(config: { text: string; query_timeout: number }) {
      const { text } = config;
      state.queries.push(text);
      state.queryTimeouts?.push(config.query_timeout);
      if (text.includes("unlock")) {
        if (state.neverSettleUnlock) return new Promise(() => {});
        if (state.unlockError) throw state.unlockError;
        return { rows: [{ released: state.unlockResult ?? true }] };
      }
      if (state.neverSettleAcquire) return new Promise(() => {});
      if (state.acquireError) throw state.acquireError;
      return { rows: [{ acquired: true }] };
    },
    release(error?: Error) {
      state.releaseErrors.push(error);
    },
  };
  return {
    connect(callback: (error: Error | undefined, value: typeof client) => void) {
      callback(undefined, client);
    },
  } as unknown as pg.Pool;
}

test("read and deletion barriers use exclusive and shared session locks", async () => {
  const exclusive = { queries: [], releaseErrors: [] } satisfies FakeClientState;
  const shared = { queries: [], releaseErrors: [] } satisfies FakeClientState;

  assert.equal(await withBackupFileReadBarrier(fakePool(exclusive), async () => 1), 1);
  assert.equal(
    await withBackupFileDeletionBarrier(fakePool(shared), async () => 2),
    2,
  );
  assert.match(exclusive.queries[0]!, /pg_try_advisory_lock\(/);
  assert.match(exclusive.queries[1]!, /pg_advisory_unlock\(/);
  assert.match(shared.queries[0]!, /pg_try_advisory_lock_shared\(/);
  assert.match(shared.queries[1]!, /pg_advisory_unlock_shared\(/);
  assert.deepEqual(exclusive.releaseErrors, [undefined]);
  assert.deepEqual(shared.releaseErrors, [undefined]);
});

test("operation failures still unlock and release the client", async () => {
  const state = { queries: [], releaseErrors: [] } satisfies FakeClientState;
  const failure = new Error("copy failed");
  await assert.rejects(
    withBackupFileReadBarrier(fakePool(state), async () => {
      throw failure;
    }),
    failure,
  );
  assert.equal(state.queries.length, 2);
  assert.deepEqual(state.releaseErrors, [undefined]);
});

test("an uncertain unlock discards the pooled client", async () => {
  for (const state of [
    {
      queries: [],
      releaseErrors: [] as Array<Error | undefined>,
      unlockResult: false,
    },
    {
      queries: [],
      releaseErrors: [] as Array<Error | undefined>,
      unlockError: new Error("connection lost"),
    },
  ]) {
    assert.equal(
      await withBackupFileDeletionBarrier(fakePool(state), async () => "done"),
      "done",
    );
    assert.equal(state.releaseErrors.length, 1);
    assert.ok(state.releaseErrors[0] instanceof Error);
  }
});

test("an acquisition query error discards the possibly locked client", async () => {
  const state: FakeClientState = {
    queries: [],
    releaseErrors: [],
    acquireError: new Error("connection lost after query"),
  };
  await assert.rejects(
    withBackupFileReadBarrier(fakePool(state), async () => undefined),
    state.acquireError,
  );
  assert.equal(state.releaseErrors.length, 1);
  assert.ok(state.releaseErrors[0] instanceof Error);
});

test("acquisition applies the remaining query timeout and bounds an unknown result", async () => {
  const state: FakeClientState = {
    queries: [],
    queryTimeouts: [],
    releaseErrors: [],
    neverSettleAcquire: true,
  };
  const barrier = withAbortableBackupFileDeletionBarrier(
    fakePool(state),
    async () => assert.fail("operation must not run"),
    { timeoutMs: 20 },
  );
  await assert.rejects(
    Promise.race([
      barrier,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("independent test timeout")), 500),
      ),
    ]),
    (error: Error) =>
      /Timed out executing backup file lock query/.test(error.message),
  );
  assert.equal(state.queryTimeouts?.length, 1);
  assert.ok(state.queryTimeouts![0]! > 0);
  assert.ok(state.queryTimeouts![0]! <= 20);
  assert.ok(state.releaseErrors[0] instanceof Error);
});

test("unlock cleanup is bounded and discards a client with unknown lock state", async () => {
  const state: FakeClientState = {
    queries: [],
    queryTimeouts: [],
    releaseErrors: [],
    neverSettleUnlock: true,
  };
  const barrier = withAbortableBackupFileDeletionBarrier(
    fakePool(state),
    async () => "deleted",
    { timeoutMs: 20 },
  );
  assert.equal(
    await Promise.race([
      barrier,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("independent test timeout")), 500),
      ),
    ]),
    "deleted",
  );
  assert.equal(state.queryTimeouts?.length, 2);
  assert.equal(state.queryTimeouts?.[1], 20);
  assert.ok(state.releaseErrors[0] instanceof Error);
});

test("an aborted deletion does not enter its operation", async () => {
  const state = { queries: [], releaseErrors: [] } satisfies FakeClientState;
  const controller = new AbortController();
  controller.abort();
  let entered = false;
  await assert.rejects(
    withAbortableBackupFileDeletionBarrier(
      fakePool(state),
      async () => {
        entered = true;
      },
      { signal: controller.signal },
    ),
    (error: Error) => error.name === "AbortError",
  );
  assert.equal(entered, false);
  assert.deepEqual(state.queries, []);
});