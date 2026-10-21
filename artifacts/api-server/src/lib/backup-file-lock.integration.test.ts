import assert from "node:assert/strict";
import { test } from "node:test";

import pg from "pg";

import {
  withBackupFileDeletionBarrier,
  withBackupFileReadBarrier,
} from "./backup-file-lock";

const { Pool } = pg;

test("exclusive backup blocks deletion while shared deletions coexist", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is not available");
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 5_000,
  });
  try {
    let releaseBackup!: () => void;
    let backupEntered!: () => void;
    const backupReady = new Promise<void>((resolve) => { backupEntered = resolve; });
    const holdBackup = new Promise<void>((resolve) => { releaseBackup = resolve; });
    const backup = withBackupFileReadBarrier(pool, async () => {
      backupEntered();
      await holdBackup;
    });
    await backupReady;

    let deletionEntered = false;
    const blockedDeletion = withBackupFileDeletionBarrier(pool, async () => {
      deletionEntered = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(deletionEntered, false);
    releaseBackup();
    await Promise.all([backup, blockedDeletion]);
    assert.equal(deletionEntered, true);

    let releaseFirst!: () => void;
    let firstEntered!: () => void;
    const firstReady = new Promise<void>((resolve) => { firstEntered = resolve; });
    const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = withBackupFileDeletionBarrier(pool, async () => {
      firstEntered();
      await holdFirst;
    });
    await firstReady;
    let secondEntered = false;
    await withBackupFileDeletionBarrier(pool, async () => {
      secondEntered = true;
    });
    assert.equal(secondEntered, true);
    releaseFirst();
    await first;
  } finally {
    await pool.end();
  }
});