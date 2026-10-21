/**
 * Opt-in, disposable PostgreSQL roundtrip. Never reads DATABASE_URL or cloud
 * credentials. Requires initdb/pg_ctl/pg_dump/pg_restore on PATH (same version).
 * Bundle like backup.test.ts, then run with BACKUP_LOCAL_INTEGRATION=1.
 * Run in its own node --test process: the object-storage prototype is stubbed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { Readable } from "node:stream";
import pg from "pg";
import { ObjectStorageService, ObjectNotFoundError } from "../objectStorage";
import { create, verifyRestore, latestComplete, complete, type Manifest } from "./operations";
import { seal, unseal, encryptFile, decryptFile } from "./security";
import type { Config } from "./config";
import type { BackupStore } from "./store";

const exec = promisify(execFile);
const localEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8" };

// Only transport is faked; envelopes, streaming encryption, dump and restore
// are production implementations. No S3 client is constructed.
class MemoryStore {
  readonly objects = new Map<string, Buffer>();
  constructor(readonly cfg: Config) {}
  async json(key: string, value: unknown) {
    assert(!this.objects.has(key), "immutable key already exists");
    this.objects.set(key, seal(Buffer.from(JSON.stringify(value)), this.cfg.key, key));
  }
  async readJson<T>(key: string): Promise<T> {
    return JSON.parse(unseal(this.get(key), this.cfg.key, key).toString());
  }
  get(key: string) {
    const value = this.objects.get(key);
    assert(value, "backup object missing");
    return value;
  }
  async upload(key: string, path: string) {
    assert(!this.objects.has(key));
    this.objects.set(key, await readFile(path));
  }
  async download(key: string, path: string) {
    await writeFile(path, this.get(key), { flag: "wx", mode: 0o600 });
  }
  async exists(key: string) { this.get(key); }
  async list(suffix: string) {
    return [...this.objects.keys()].filter(key => key.endsWith(suffix)).sort().reverse();
  }
  asStore() { return this as unknown as BackupStore; }
}

async function freePort(host: string) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

test("real isolated PostgreSQL encrypted backup and restore", {
  skip: process.env.BACKUP_LOCAL_INTEGRATION !== "1",
  timeout: 180_000,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), "warehouse-roundtrip-"));
  const clusters: string[] = [];
  const clients: pg.Pool[] = [];
  const originalGet = ObjectStorageService.prototype.getObjectEntityFile;
  const tool = async (name: string, args: string[]) => {
    try { await exec(name, args, { env: localEnv, timeout: 30_000 }); }
    catch { throw new Error(`Disposable integration PostgreSQL tool failed: ${name}`); }
  };
  const start = async (name: string, host: string) => {
    const directory = join(root, name);
    const socket = join(root, `${name}-socket`);
    await mkdir(socket, { mode: 0o700 });
    const port = await freePort(host);
    await tool("initdb", ["-D", directory, "-U", "backup_test", "--auth=trust", "--no-locale", "--encoding=UTF8"]);
    // Register before startup so even a partially successful start is stopped.
    clusters.push(directory);
    await tool("pg_ctl", ["-D", directory, "-l", join(root, `${name}.log`),
      "-o", `-h ${host} -p ${port} -k ${socket} -c log_statement=${name === "source" ? "all" : "ddl"}`, "-w", "start"]);
    const url = `postgresql://backup_test@${host}:${port}/postgres`;
    const db = new pg.Pool({ connectionString: url });
    clients.push(db);
    return { url, db };
  };
  try {
    const source = await start("source", "127.0.0.1");
    const target = await start("target", "127.0.0.2");
    const sourceName = `source_${randomUUID().replaceAll("-", "")}`;
    await source.db.query(`CREATE DATABASE "${sourceName}" TEMPLATE template0`);
    const sourceUrl = new URL(source.url);
    sourceUrl.pathname = `/${sourceName}`;
    const data = new pg.Pool({ connectionString: sourceUrl.href });
    clients.push(data);
    const id = randomUUID();
    const document = Buffer.from("Authentic locally seeded integration document\n" + randomBytes(512).toString("hex"));
    await data.query(`
      CREATE TABLE public.deliveries (id integer PRIMARY KEY, label text NOT NULL);
      CREATE TABLE public.delivery_photos (
        id uuid PRIMARY KEY, delivery_id integer REFERENCES public.deliveries(id),
        object_path text NOT NULL, file_name text NOT NULL, mime_type text NOT NULL
      );
      CREATE INDEX photos_delivery_idx ON public.delivery_photos(delivery_id);
      CREATE SCHEMA audit;
      CREATE TABLE audit.events (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, message text);
      INSERT INTO public.deliveries VALUES (1, 'Local delivery');
      INSERT INTO audit.events(message) VALUES ('seeded');
    `);
    await data.query("INSERT INTO public.delivery_photos VALUES ($1, 1, $2, $3, $4)",
      [id, "/objects/integration/document", "акт.txt", "text/plain"]);
    let missing = false;
    ObjectStorageService.prototype.getObjectEntityFile = async function (path) {
      assert.equal(path, "/objects/integration/document");
      if (missing) throw new ObjectNotFoundError();
      return { createReadStream: () => Readable.from([document]) } as Awaited<ReturnType<typeof originalGet>>;
    };
    const cfg: Config = {
      environment: "development", source: sourceUrl.href, sourceId: "disposable-integration", key: randomBytes(32),
      prefix: "warehouse/development/", endpoint: "https://storage.yandexcloud.net/",
      region: "ru-central1", bucket: "unused-local-test",
      credentials: { accessKeyId: "unused", secretAccessKey: "unused" },
    };
    const store = new MemoryStore(cfg);
    const env = { BACKUP_RESTORE_DATABASE_URL: target.url, BACKUP_RESTORE_ALLOW_ISOLATED: "true" };
    const databaseNames = async () => (await target.db.query("SELECT datname FROM pg_database ORDER BY datname")).rows;
    const baseline = await databaseNames();
    const targetDdl = async () => (await readFile(join(root, "target.log"), "utf8"))
      .split("\n").filter(line => /\b(?:CREATE|DROP) DATABASE\b/.test(line));

    await t.test("snapshot dump, encrypted document, schema/counts/references and successful drill", async () => {
      assert.equal((await create(store.asStore())).ok, true);
      const manifest = await latestComplete(store.asStore());
      assert(complete(manifest));
      assert.deepEqual(manifest.counts, {
        '"audit"."events"': "1", '"public"."deliveries"': "1", '"public"."delivery_photos"': "1",
      });
      assert.equal(manifest.refs[0].id, id);
      assert.equal(manifest.refs[0].file_name, "акт.txt");
      assert(manifest.schema!.constraints.length >= 4);
      const file = manifest.files[id];
      const encrypted = join(root, "document.enc"), plain = join(root, "document");
      await store.download(file.key, encrypted);
      await decryptFile(encrypted, plain, cfg.key, file.key, file);
      assert.deepEqual(await readFile(plain), document);
      const result = await verifyRestore(store.asStore(), env);
      assert.equal(result.ok, true);
      assert.equal(result.tables, 3);
      assert.equal(result.files, 1);
      assert.deepEqual(await databaseNames(), baseline);
      assert.equal((await targetDdl()).length, 2, "real drill created and dropped exactly one database");
    });
    const manifest = await latestComplete(store.asStore());
    const manifestKey = `${cfg.prefix}${manifest.runId}/manifest.enc`;
    await t.test("missing source document retains salvage but never publishes completion", async subtest => {
      const salvage = new MemoryStore(cfg);
      missing = true;
      try { await assert.rejects(create(salvage.asStore()), /INCOMPLETE/); }
      finally { missing = false; }
      assert.equal((await salvage.list("/complete.enc")).length, 0);
      const saved = await salvage.readJson<Manifest>((await salvage.list("/manifest.enc"))[0]);
      assert.equal(saved.status, "INCOMPLETE");
      assert.deepEqual(saved.missing, [id]);
      assert(saved.dump && salvage.objects.has(saved.dump.key));
      await assert.rejects(latestComplete(salvage.asStore()), /No authenticated complete/);
      await subtest.test("scheduled known-missing snapshot under 23h rejects without another dump", async () => {
        assert.equal(saved.failureReason, "MISSING_REFERENCES");
        const snapshots = async () => (await readFile(join(root, "source.log"), "utf8"))
          .split("\n").filter(line => line.includes("pg_export_snapshot()")).length;
        const beforeSnapshots = await snapshots();
        assert(beforeSnapshots >= 2, "successful and salvage snapshots were actually exported");
        const beforeObjects = new Map(salvage.objects);
        await assert.rejects(create(salvage.asStore(), true), /duplicate salvage skipped.*UNHEALTHY/);
        assert.equal(await snapshots(), beforeSnapshots, "scheduler did not export another dump snapshot");
        assert.deepEqual(salvage.objects, beforeObjects, "scheduler wrote no new dump or run records");
        assert.equal((await salvage.list("/complete.enc")).length, 0);
      });
    });
    for (const [name, key] of [["dump", manifest.dump!.key], ["document", manifest.files[id].key]]) {
      await t.test(`corrupt ${name} fails authentication before any DDL`, async () => {
        const saved = store.get(key);
        const damaged = Buffer.from(saved);
        damaged[damaged.length - 1] ^= 1;
        const before = await targetDdl();
        store.objects.set(key, damaged);
        try { await assert.rejects(verifyRestore(store.asStore(), env)); }
        finally { store.objects.set(key, saved); }
        assert.deepEqual(await databaseNames(), baseline);
        assert.deepEqual(await targetDdl(), before);
      });
    }
    await t.test("authenticated invalid dump exercises pg_restore failure and owned database cleanup", async () => {
      const oldDump = store.get(manifest.dump!.key), oldManifest = store.get(manifestKey);
      const invalid = join(root, "invalid.dump"), encrypted = join(root, "invalid.enc");
      await writeFile(invalid, "not a PostgreSQL archive");
      const integrity = await encryptFile(invalid, encrypted, cfg.key, manifest.dump!.key);
      const changed = structuredClone(manifest);
      changed.dump = { key: manifest.dump!.key, ...integrity };
      store.objects.set(changed.dump.key, await readFile(encrypted));
      store.objects.set(manifestKey, seal(Buffer.from(JSON.stringify(changed)), cfg.key, manifestKey));
      const before = (await targetDdl()).length;
      try { await assert.rejects(verifyRestore(store.asStore(), env), /pg_restore failed/); }
      finally { store.objects.set(manifest.dump!.key, oldDump); store.objects.set(manifestKey, oldManifest); }
      assert.deepEqual(await databaseNames(), baseline);
      assert.equal((await targetDdl()).length, before + 2);
    });
    await t.test("schema/count/reference mismatch fails and removes owned database", async () => {
      for (const field of ["counts", "schema", "refs"] as const) {
        const saved = store.get(manifestKey), changed = structuredClone(manifest);
        if (field === "counts") changed.counts['"public"."deliveries"'] = "99";
        if (field === "schema") changed.schema!.columns[0].is_nullable = "unexpected";
        if (field === "refs") changed.refs[0].file_name = "wrong.txt";
        store.objects.set(manifestKey, seal(Buffer.from(JSON.stringify(changed)), cfg.key, manifestKey));
        try { await assert.rejects(verifyRestore(store.asStore(), env), /differ/); }
        finally { store.objects.set(manifestKey, saved); }
        assert.deepEqual(await databaseNames(), baseline);
      }
    });
    await t.test("invalid target and missing authorization perform no DDL", async () => {
      const before = await targetDdl();
      await assert.rejects(verifyRestore(store.asStore(), { ...env, BACKUP_RESTORE_ALLOW_ISOLATED: undefined }));
      await assert.rejects(verifyRestore(store.asStore(), { ...env, BACKUP_RESTORE_DATABASE_URL: source.url }));
      const sameDatabase = new URL(target.url); sameDatabase.pathname = sourceUrl.pathname;
      await assert.rejects(verifyRestore(store.asStore(), { ...env, BACKUP_RESTORE_DATABASE_URL: sameDatabase.href }));
      assert.deepEqual(await targetDdl(), before);
      assert.deepEqual(await databaseNames(), baseline);
    });
  } finally {
    ObjectStorageService.prototype.getObjectEntityFile = originalGet;
    await Promise.all(clients.map(client => client.end()));
    // A failed stop is a test failure; retain the directory rather than deleting
    // files underneath a running PostgreSQL process.
    const stopped = await Promise.allSettled(clusters.reverse().map(directory =>
      tool("pg_ctl", ["-D", directory, "-m", "immediate", "-w", "stop"])));
    assert(stopped.every(result => result.status === "fulfilled"), "Disposable PostgreSQL cleanup failed");
    await rm(root, { recursive: true, force: true });
  }
});