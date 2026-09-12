import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";

import { bulkSiteImportSlowWindowsTable } from "@workspace/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig } from "drizzle-orm/pg-core";
import pg from "pg";

import {
  BULK_SITE_IMPORT_REPEATED_SLOW_SIGNAL_FIELD_NAMES,
  BULK_SITE_IMPORT_SLOW_AGGREGATION_WINDOW_MS,
  type BulkSiteImportPhase,
  type BulkSiteImportSlowWarningFields,
} from "./bulk-site-import-log.ts";
import {
  cleanupExpiredBulkSiteImportSlowWindows,
  createBulkSiteImportSlowWarningAggregator,
} from "./bulk-site-import-slow-store.ts";

const { Pool } = pg;
const schemaName = `bulk_slow_test_${randomUUID().replaceAll("-", "")}`;
const tableConfig = getTableConfig(bulkSiteImportSlowWindowsTable);
const quotedSchema = `"${schemaName}"`;
const quotedTable = `"${tableConfig.name}"`;

let administrationPool: pg.Pool;
let testPool: pg.Pool;

function isolatedPool(max = 10): pg.Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max,
    options: `-c search_path=${schemaName},public`,
  });
}

function database(pool: pg.Pool) {
  return drizzle(pool);
}

function warning(
  phase: BulkSiteImportPhase,
  rowCount: number,
  durationMs: number,
  thresholdMs: number,
): BulkSiteImportSlowWarningFields {
  return {
    phase,
    rowCount,
    durationMs,
    thresholdMs,
    minimumRowsPerSecond: phase === "validation" ? 200 : 50,
  };
}

async function rows(pool = testPool): Promise<Array<Record<string, unknown>>> {
  const result = await pool.query(
    `SELECT * FROM ${quotedTable} ORDER BY phase`,
  );
  return result.rows;
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
  administrationPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  await administrationPool.query(`CREATE SCHEMA ${quotedSchema}`);

  const columns = tableConfig.columns.map((column) => {
    const constraints = [
      column.notNull ? "NOT NULL" : "",
      column.primary ? "PRIMARY KEY" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `"${column.name}" ${column.getSQLType()} ${constraints}`.trim();
  });
  await administrationPool.query(
    `CREATE TABLE ${quotedSchema}.${quotedTable} (
      ${columns.join(",\n")},
      CHECK ("phase" IN ('validation', 'write'))
    )`,
  );
  testPool = isolatedPool();
});

beforeEach(async () => {
  await testPool.query(`TRUNCATE TABLE ${quotedTable}`);
});

after(async () => {
  await testPool?.end();
  if (administrationPool) {
    await administrationPool.query(
      `DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`,
    );
    await administrationPool.end();
  }
});

test("parallel independent connections do not lose increments and emit exactly one signal", async () => {
  const aggregate = createBulkSiteImportSlowWarningAggregator(database(testPool));
  const calls = Array.from({ length: 24 }, (_, index) =>
    aggregate(warning("write", 100 + index, 5_000 + index, 4_000 + index)),
  );
  const signals = (await Promise.all(calls)).filter(
    (signal) => signal !== null,
  );

  assert.equal(signals.length, 1);
  assert.equal(signals[0]?.occurrenceCount, 3);
  const [row] = await rows();
  assert.equal(row.occurrence_count, 24);
});

test("a fresh store and pool retain two occurrences and emit the third", async () => {
  const firstPool = isolatedPool(2);
  const firstAggregate = createBulkSiteImportSlowWarningAggregator(
    database(firstPool),
  );
  assert.equal(await firstAggregate(warning("write", 10, 4_000, 2_200)), null);
  assert.equal(await firstAggregate(warning("write", 20, 5_000, 2_400)), null);
  await firstPool.end();

  const freshPool = isolatedPool(1);
  try {
    const freshAggregate = createBulkSiteImportSlowWarningAggregator(
      database(freshPool),
    );
    const signal = await freshAggregate(
      warning("write", 30, 6_000, 2_600),
    );
    assert.equal(signal?.occurrenceCount, 3);
    assert.equal(signal?.maximumRowCount, 30);
  } finally {
    await freshPool.end();
  }
});

test("phases have independent windows and preserve all maxima", async () => {
  const aggregate = createBulkSiteImportSlowWarningAggregator(database(testPool));

  assert.equal(
    await aggregate(warning("validation", 500, 8_000, 3_500)),
    null,
  );
  assert.equal(await aggregate(warning("write", 900, 7_000, 5_000)), null);
  assert.equal(
    await aggregate(warning("validation", 300, 12_000, 2_500)),
    null,
  );
  assert.equal(await aggregate(warning("write", 700, 15_000, 9_000)), null);

  const validationSignal = await aggregate(
    warning("validation", 400, 10_000, 4_500),
  );
  const writeSignal = await aggregate(
    warning("write", 800, 11_000, 7_000),
  );

  assert.deepEqual(validationSignal, {
    phase: "validation",
    occurrenceCount: 3,
    windowMs: BULK_SITE_IMPORT_SLOW_AGGREGATION_WINDOW_MS,
    maximumRowCount: 500,
    maximumDurationMs: 12_000,
    maximumThresholdMs: 4_500,
  });
  assert.deepEqual(writeSignal, {
    phase: "write",
    occurrenceCount: 3,
    windowMs: BULK_SITE_IMPORT_SLOW_AGGREGATION_WINDOW_MS,
    maximumRowCount: 900,
    maximumDurationMs: 15_000,
    maximumThresholdMs: 9_000,
  });
  assert.deepEqual(Object.keys(writeSignal ?? {}), [
    ...BULK_SITE_IMPORT_REPEATED_SLOW_SIGNAL_FIELD_NAMES,
  ]);
  assert.equal((await rows()).length, 2);
});

test("an expiry exactly at the database boundary starts a new window", async () => {
  await testPool.query(
    `INSERT INTO ${quotedTable}
      (phase, started_at, expires_at, occurrence_count, maximum_row_count,
       maximum_duration_ms, maximum_threshold_ms)
     VALUES ('write', clock_timestamp() - interval '15 minutes',
             clock_timestamp(), 2, 999, 99999, 9999)`,
  );

  const aggregate = createBulkSiteImportSlowWarningAggregator(database(testPool));
  assert.equal(await aggregate(warning("write", 7, 3_001, 3_000)), null);

  const [row] = await rows();
  assert.equal(row.occurrence_count, 1);
  assert.equal(row.maximum_row_count, 7);
  assert.equal(row.maximum_duration_ms, 3_001);
  assert.equal(row.maximum_threshold_ms, 3_000);
  assert.ok((row.started_at as Date).getTime() > Date.now() - 10_000);
});

test("cleanup removes only expired windows from the isolated table", async () => {
  await testPool.query(
    `INSERT INTO ${quotedTable}
      (phase, started_at, expires_at, occurrence_count, maximum_row_count,
       maximum_duration_ms, maximum_threshold_ms)
     VALUES
      ('validation', clock_timestamp() - interval '16 minutes',
       clock_timestamp() - interval '1 minute', 2, 10, 20, 30),
      ('write', clock_timestamp(), clock_timestamp() + interval '15 minutes',
       2, 40, 50, 60)`,
  );

  await cleanupExpiredBulkSiteImportSlowWindows(database(testPool));

  const remaining = await rows();
  assert.deepEqual(
    remaining.map((row) => row.phase),
    ["write"],
  );
});