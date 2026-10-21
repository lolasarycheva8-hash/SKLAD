import assert from "node:assert/strict";
import { test } from "node:test";
import { readLoadedCounter } from "./read-loaded-counter.ts";

test("captures the loaded value without a second read during rerender", async () => {
  const values = ["", "Привязка водителей (0)", "Привязка водителей (3)", ""];
  let reads = 0;
  const count = await readLoadedCounter(
    async () => values[reads++]!,
    async () => {},
  );
  assert.equal(count, 3);
  assert.equal(reads, 3);
});

test("rejects an unloaded or invalid count rather than inventing a baseline", async () => {
  for (const text of ["", "Привязка водителей", "(0)", "(-1)", "(NaN)", "(9007199254740992)"]) {
    await assert.rejects(
      readLoadedCounter(async () => text, async () => {}, 2),
      /Timed out waiting for a loaded positive legacy assignment count/,
    );
  }
});

test("does not hide browser errors", async () => {
  await assert.rejects(
    readLoadedCounter(async () => { throw new Error("CDP socket closed"); }, async () => {}),
    /CDP socket closed/,
  );
});
