import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import pg from "pg";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { canonicalClientNameSql } from "../src/schema/clients.ts";
import { inspectClientNameConflicts, formatConflictReport } from "./client-name-conflicts.mjs";

test("both schema entry points gate DDL on the read-only preflight", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  for (const command of ["push", "push-force"]) {
    assert.match(pkg.scripts[command], /^pnpm run check:client-names && drizzle-kit push\b/);
  }
  const postMerge = await readFile(new URL("../../../scripts/post-merge.sh", import.meta.url), "utf8");
  assert.match(postMerge, /pnpm --filter @workspace\/db run push-force/);
});

test("historical collisions are reported idempotently, with links, without DDL or writes", async () => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const schema = `client_preflight_${randomUUID().replaceAll("-", "")}`;
  const q = `"${schema}"`;
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${q}`);
    await client.query(`CREATE TABLE ${q}.clients (id uuid PRIMARY KEY, name text NOT NULL)`);
    await client.query(`CREATE TABLE ${q}.sites (id uuid PRIMARY KEY, client_id uuid REFERENCES ${q}.clients(id), client text NOT NULL)`);
    await client.query(`CREATE TABLE ${q}.orders (id uuid PRIMARY KEY, client_id uuid REFERENCES ${q}.clients(id))`);
    const ids = Array.from({ length: 5 }, () => randomUUID());
    const names = ["AB", "A\u200BB", "A\u200CB", "A\u200DB", "A\u2060B"];
    for (let index = 0; index < ids.length; index++) {
      await client.query(`INSERT INTO ${q}.clients VALUES ($1,$2)`, [ids[index], names[index]]);
    }
    await client.query(`INSERT INTO ${q}.clients VALUES ($1,$2)`, [randomUUID(), "A B"]);
    await client.query(`INSERT INTO ${q}.sites VALUES ($1,$2,$3),($4,NULL,$5)`,
      [randomUUID(), ids[1], names[1], randomUUID(), "A\u200DB"]);
    await client.query(`INSERT INTO ${q}.orders VALUES ($1,$2)`, [randomUUID(), ids[2]]);
    // Protect a non-conflicting legacy index to prove preflight does not replace/drop it.
    await client.query(`CREATE UNIQUE INDEX historical_names ON ${q}.clients(name)`);
    const before = await client.query(`SELECT * FROM ${q}.clients ORDER BY id`);
    const indexes = await client.query("SELECT indexdef FROM pg_indexes WHERE schemaname=$1 ORDER BY indexname", [schema]);
    const first = await inspectClientNameConflicts(client, schema);
    assert.deepEqual(await inspectClientNameConflicts(client, schema), first);
    assert.equal(first.groups.length, 1);
    const group = first.groups[0];
    assert.equal(group.canonicalName, "ab");
    assert.deepEqual(group.clients.map((row) => row.id).sort(), [...ids].sort());
    assert.equal(group.unlinkedSiteCount, 1);
    assert.equal(group.clients.find((row) => row.id === ids[1]).siteCount, 1);
    assert.equal(group.clients.find((row) => row.id === ids[2]).orderCount, 1);
    assert.equal(group.clients.find((row) => row.id === ids[1]).escapedName, "A\\u200BB");
    assert.equal(JSON.parse(formatConflictReport(first)).ok, false);
    assert.deepEqual((await client.query(`SELECT * FROM ${q}.clients ORDER BY id`)).rows, before.rows);
    assert.deepEqual(
      (await client.query("SELECT indexdef FROM pg_indexes WHERE schemaname=$1 ORDER BY indexname", [schema])).rows,
      indexes.rows,
    );
    // A fresh database containing historical conflicts must fail the additive
    // generated-column index, never silently repair data or replace the legacy index.
    await client.query("SAVEPOINT failed_index");
    const indexExpression = new PgDialect().sqlToQuery(
      canonicalClientNameSql(sql.identifier("name")),
    );
    assert.deepEqual(indexExpression.params, []);
    await client.query(`ALTER TABLE ${q}.clients ADD COLUMN name_canonical text GENERATED ALWAYS AS (${indexExpression.sql}) STORED`);
    await assert.rejects(
      client.query(`CREATE UNIQUE INDEX clients_name_invisible_normalized_uq ON ${q}.clients (name_canonical)`),
      (error) => {
        assert.equal(error.code, "23505");
        return true;
      },
    );
    await client.query("ROLLBACK TO SAVEPOINT failed_index");
    assert.deepEqual((await client.query(`SELECT * FROM ${q}.clients ORDER BY id`)).rows, before.rows);
    assert.deepEqual(
      (await client.query("SELECT indexdef FROM pg_indexes WHERE schemaname=$1 ORDER BY indexname", [schema])).rows,
      indexes.rows,
    );
    // Simulate operator-approved distinct names, not automatic merging.
    for (let index = 1; index < ids.length; index++) {
      await client.query(`UPDATE ${q}.clients SET name=$1 WHERE id=$2`, [`AB подразделение ${index}`, ids[index]]);
    }
    assert.deepEqual((await inspectClientNameConflicts(client, schema)).groups, []);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${q}.sites`)).rows[0].n, 2);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${q}.orders`)).rows[0].n, 1);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});