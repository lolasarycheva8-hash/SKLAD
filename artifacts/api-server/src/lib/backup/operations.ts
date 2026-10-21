import { randomUUID } from "node:crypto";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type pg from "pg";
import { ObjectStorageService, ObjectNotFoundError } from "../objectStorage";
import { withBackupFileReadBarrier } from "../backup-file-lock";
import { BackupStore } from "./store";
import type { Config } from "./config";
import { encryptFile, decryptFile, fresh, restoreGuard } from "./security";
import { pool, counts, command, ident, distinctHosts, schema } from "./postgres";
import { BackupFailure, bounded, operationSignal, throwIfStopped } from "./runtime";

export type Reference = { id: string; object_path: string; file_name: string; mime_type: string };
type Item = { key: string; sha256: string; bytes: number };
export type Manifest = {
  version: 1; runId: string; environment: string; sourceId: string; snapshotStartedAt: string;
  source: { host: string; port: string; database: string };
  status: "COMPLETE" | "INCOMPLETE";
  counts: Record<string, string>; refs: Reference[];
  schema?: Awaited<ReturnType<typeof schema>>;
  files: Record<string, Item>; missing: string[]; dump?: Item;
  failureReason?: "MISSING_REFERENCES" | "ACQUISITION_FAILED";
};
const referenceSql = "SELECT id::text, object_path, file_name, mime_type FROM public.delivery_photos ORDER BY id";
export function complete(manifest: Manifest) {
  return manifest.status === "COMPLETE" && !!manifest.dump && !!manifest.schema && manifest.missing.length === 0
    && new Set(manifest.refs.map(ref => ref.id)).size === manifest.refs.length
    && Object.keys(manifest.files).length === manifest.refs.length
    && manifest.refs.every(ref => !!manifest.files[ref.id]);
}
async function temporary<T>(operation: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "warehouse-backup-"));
  await chmod(dir, 0o700);
  try { return await operation(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
function runPrefix(cfg: Config, runId: string) { return `${cfg.prefix}${runId}/`; }
export function validate(manifest: Manifest, cfg: Config, key: string, requireCurrentSource = true) {
  if (manifest.version !== 1 || manifest.environment !== cfg.environment || manifest.sourceId !== cfg.sourceId
    || !/^\d{4}-\d{2}-\d{2}T[\dZ.-]+_[a-f0-9-]{36}$/.test(manifest.runId)
    || key !== `${runPrefix(cfg, manifest.runId)}manifest.enc`
    || !Number.isFinite(Date.parse(manifest.snapshotStartedAt))) throw new Error("Invalid authenticated manifest");
  const source = new URL(cfg.source);
  if (!/^\d+$/.test(manifest.source.port) || Number(manifest.source.port) < 1 || Number(manifest.source.port) > 65535) throw new Error("Invalid authenticated source port");
  if (requireCurrentSource && (manifest.source.host !== source.hostname || manifest.source.port !== (source.port || "5432") || manifest.source.database !== decodeURIComponent(source.pathname.slice(1)))) throw new Error("Backup source host/port/database does not match current configured source");
  const prefix = runPrefix(cfg, manifest.runId);
  if (manifest.dump && manifest.dump.key !== `${prefix}dump.enc`) throw new Error("Invalid dump key");
  for (const [id, item] of Object.entries(manifest.files)) {
    if (!/^[a-f0-9-]{36}$/.test(id) || item.key !== `${prefix}files/${id}.enc` || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 0) throw new Error("Invalid file mapping");
  }
}
export async function latestComplete(store: BackupStore, requireCurrentSource = true) {
  for (const key of await store.list("/complete.enc")) {
    const marker = await store.readJson<{ runId: string; sourceId: string; environment: string; manifest: string }>(key);
    if (marker.sourceId !== store.cfg.sourceId || marker.environment !== store.cfg.environment || key !== `${runPrefix(store.cfg, marker.runId)}complete.enc` || marker.manifest !== `${runPrefix(store.cfg, marker.runId)}manifest.enc`) throw new Error("Invalid authenticated completion marker");
    const manifest = await store.readJson<Manifest>(marker.manifest);
    validate(manifest, store.cfg, marker.manifest, requireCurrentSource);
    if (manifest.runId !== marker.runId || !complete(manifest)) throw new Error("Incomplete backup has completion marker");
    return manifest;
  }
  throw new BackupFailure("No authenticated complete backup exists for the configured source identity/environment.");
}
export async function verifyPayloads(store: BackupStore, manifest: Manifest) {
  if (!manifest.dump) throw new Error("Dump missing");
  await temporary(async dir => {
    for (const item of [manifest.dump!, ...Object.values(manifest.files)]) {
      throwIfStopped();
      const encrypted = join(dir, "item.enc"), plain = join(dir, "item");
      try {
        await store.download(item.key, encrypted);
        await decryptFile(encrypted, plain, store.cfg.key, item.key, item);
      } finally {
        await rm(encrypted, { force: true }); await rm(plain, { force: true });
      }
    }
  });
}
export async function health(store: BackupStore) {
  const manifest = await latestComplete(store);
  if (!fresh(manifest.snapshotStartedAt)) throw new BackupFailure("Backup is stale: snapshot age exceeds 24 hours or timestamp invalid");
  const starts = await store.list("/started.enc");
  if (!starts.length) throw new Error("Backup start record missing");
  const latest = await store.readJson<{ runId: string; environment: string; sourceId: string }>(starts[0]);
  if (latest.runId !== manifest.runId || latest.environment !== store.cfg.environment || latest.sourceId !== store.cfg.sourceId
    || starts[0] !== `${runPrefix(store.cfg, latest.runId)}started.enc`) throw new BackupFailure("Latest backup attempt is incomplete or still running");
  await verifyPayloads(store, manifest);
  if (!fresh(manifest.snapshotStartedAt)) throw new BackupFailure("Backup became stale during verification");
  return { ok: true, integrityVerified: true, snapshotStartedAt: manifest.snapshotStartedAt, ageSeconds: Math.floor((Date.now() - Date.parse(manifest.snapshotStartedAt)) / 1000), files: manifest.refs.length };
}
export async function recentKnownMissing(store: BackupStore, now = Date.now()) {
  const starts = await store.list("/started.enc");
  if (!starts.length) return false;
  const start = await store.readJson<{ runId: string; sourceId: string; environment: string }>(starts[0]);
  if (start.sourceId !== store.cfg.sourceId || start.environment !== store.cfg.environment
    || starts[0] !== `${runPrefix(store.cfg, start.runId)}started.enc`) throw new Error("Invalid backup start identity");
  let manifest: Manifest;
  const key = `${runPrefix(store.cfg, start.runId)}manifest.enc`;
  try { manifest = await store.readJson<Manifest>(key); }
  catch (error) {
    // Only an absent terminal manifest is a retryable interrupted attempt. Authentication/network failures fail closed.
    if ((error as { name?: string }).name === "NoSuchKey") return false;
    throw error;
  }
  validate(manifest, store.cfg, key);
  const age = now - Date.parse(manifest.snapshotStartedAt);
  return manifest.status === "INCOMPLETE" && manifest.failureReason === "MISSING_REFERENCES"
    && !!manifest.dump && manifest.missing.length > 0 && age >= 0 && age < 23 * 3600_000;
}
async function sourceCounts(client: pg.PoolClient, manifest: Manifest) {
  manifest.counts = await counts(client);
  manifest.schema = await schema(client);
  manifest.refs = (await client.query<Reference>(referenceSql)).rows;
}
export async function create(store: BackupStore, dueOnly = false) {
  const cfg = store.cfg, db = pool(cfg.source);
  let lease: pg.PoolClient | undefined;
  try {
    lease = await db.connect();
    // Serialize scheduler/manual runs across hosts. No time-based lock expiry.
    const acquired = await lease.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(782310, 91201) AS locked");
    if (!acquired.rows[0].locked) throw new BackupFailure("Another backup run is active");
    if (dueOnly) {
      if (await recentKnownMissing(store)) throw new BackupFailure("Known-missing incomplete snapshot is under 23h old; duplicate salvage skipped; backup remains UNHEALTHY");
      try {
        const status = await health(store);
        if (status.ageSeconds < 23 * 3600) return { ...status, skipped: true };
      } catch { /* Missing, stale or incomplete attempts are retried; never marked successful here. */ }
    }
    return await temporary(async dir => {
      const runId = `${new Date().toISOString().replaceAll(":", "-")}_${randomUUID()}`;
      const prefix = runPrefix(cfg, runId), source = new URL(cfg.source);
      const manifest: Manifest = {
        version: 1, runId, environment: cfg.environment, sourceId: cfg.sourceId, snapshotStartedAt: new Date().toISOString(),
        source: { host: source.hostname, port: source.port || "5432", database: decodeURIComponent(source.pathname.slice(1)) },
        status: "INCOMPLETE", counts: {}, refs: [], files: {}, missing: [],
      };
      await store.json(`${prefix}started.enc`, { runId, sourceId: cfg.sourceId, environment: cfg.environment, startedAt: manifest.snapshotStartedAt });
      const acquire = async (plain: string, key: string): Promise<Item> => {
        const encrypted = join(dir, "item.enc");
        try {
          const integrity = await encryptFile(plain, encrypted, cfg.key, key);
          await store.upload(key, encrypted);
          return { key, ...integrity };
        } finally { await rm(encrypted, { force: true }); await rm(plain, { force: true }); }
      };
      let acquisitionFailed = false;
      try {
        await withBackupFileReadBarrier(db, async () => {
          const client = await db.connect();
          try {
            await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
            const snapshot = await client.query<{ snapshot: string; started: Date }>("SELECT pg_export_snapshot() AS snapshot, transaction_timestamp() AS started");
            manifest.snapshotStartedAt = snapshot.rows[0].started.toISOString();
            await sourceCounts(client, manifest);
            const dump = join(dir, "database.dump");
            await command("pg_dump", ["--format=custom", "--no-password", "--snapshot", snapshot.rows[0].snapshot, "--file", dump], cfg.source);
            await chmod(dump, 0o600);
            manifest.dump = await acquire(dump, `${prefix}dump.enc`);
            const objects = new ObjectStorageService();
            for (const ref of manifest.refs) {
              throwIfStopped();
              const plain = join(dir, "object");
              try {
                const file = await bounded(objects.getObjectEntityFile(ref.object_path));
                await pipeline(file.createReadStream(), createWriteStream(plain, { flags: "wx", mode: 0o600 }), { signal: operationSignal() });
                manifest.files[ref.id] = await acquire(plain, `${prefix}files/${ref.id}.enc`);
              } catch (error) {
                manifest.missing.push(ref.id);
                // All unavailable references are fatal to completeness, including transient failures.
                if (!(error instanceof ObjectNotFoundError)) acquisitionFailed = true;
              } finally { await rm(plain, { force: true }); }
            }
            await client.query("COMMIT");
          } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
          finally { client.release(); }
        });
      } catch { acquisitionFailed = true; }
      manifest.status = !acquisitionFailed && manifest.dump && !manifest.missing.length && manifest.refs.every(ref => manifest.files[ref.id]) ? "COMPLETE" : "INCOMPLETE";
      if (manifest.status === "INCOMPLETE") manifest.failureReason = acquisitionFailed ? "ACQUISITION_FAILED" : "MISSING_REFERENCES";
      if (manifest.status === "COMPLETE") {
        try { await verifyPayloads(store, manifest); }
        catch { manifest.status = "INCOMPLETE"; manifest.failureReason = "ACQUISITION_FAILED"; }
      }
      await store.json(`${prefix}manifest.enc`, manifest);
      if (!complete(manifest)) throw new BackupFailure(`Backup INCOMPLETE (${manifest.failureReason}); encrypted salvage retained, no success marker`);
      throwIfStopped();
      // Immutable authenticated completion marker is always written last.
      await store.json(`${prefix}complete.enc`, { runId, sourceId: cfg.sourceId, environment: cfg.environment, manifest: `${prefix}manifest.enc` });
      return { ok: true, snapshotStartedAt: manifest.snapshotStartedAt, files: manifest.refs.length };
    });
  } finally {
    if (lease) {
      await lease.query("SELECT pg_advisory_unlock(782310, 91201)").catch(() => {});
      lease.release();
    }
    await bounded(db.end());
  }
}
export async function verifyRestore(store: BackupStore, env = process.env) {
  const restoreUrl = env.BACKUP_RESTORE_DATABASE_URL;
  if (!restoreUrl) throw new Error("Missing BACKUP_RESTORE_DATABASE_URL (isolated admin host)");
  const target = restoreGuard(store.cfg.source, restoreUrl, env.BACKUP_RESTORE_ALLOW_ISOLATED);
  await distinctHosts(store.cfg.source, restoreUrl);
  // Historical host/database may legitimately differ after a migration; stable source ID/environment may not.
  const manifest = await latestComplete(store, false);
  if (target.hostname.toLowerCase() === manifest.source.host.toLowerCase()
    || decodeURIComponent(target.pathname.slice(1)) === manifest.source.database) throw new Error("Restore host/database matches backup source");
  // Also compare historical manifest host DNS, not only current configured source.
  const historical = new URL(store.cfg.source); historical.hostname = manifest.source.host;
  await distinctHosts(historical.href, restoreUrl);
  return await temporary(async dir => {
    const recover = async (item: Item, name: string) => {
      const encrypted = join(dir, `${name}.enc`), plain = join(dir, name);
      try {
        await store.download(item.key, encrypted);
        await decryptFile(encrypted, plain, store.cfg.key, item.key, item);
        return plain;
      } finally { await rm(encrypted, { force: true }); }
    };
    // Authenticate the dump before creating any database.
    const dump = await recover(manifest.dump!, "database.dump");
    // Recovered object names are IDs, never untrusted original filenames or paths.
    for (const ref of manifest.refs) {
      const path = await recover(manifest.files[ref.id], ref.id);
      await rm(path); // Drill verifies recovery, then discards PII; never writes to live App Storage.
    }
    const admin = pool(restoreUrl);
    const database = `warehouse_drill_${randomUUID().replaceAll("-", "")}`;
    let owned = false;
    try {
      await admin.query(`CREATE DATABASE ${ident(database)} TEMPLATE template0`);
      owned = true;
      target.pathname = `/${database}`;
      await command("pg_restore", ["--no-password", "--no-owner", "--no-acl", "--exit-on-error", "--dbname", database, dump], target.href);
      const restored = pool(target.href);
      try {
        const client = await restored.connect();
        try {
          const actualCounts = await counts(client);
          if (JSON.stringify(actualCounts) !== JSON.stringify(manifest.counts)) throw new Error("Restored table set/row counts differ");
          if (JSON.stringify(await schema(client)) !== JSON.stringify(manifest.schema)) throw new Error("Restored schema differs");
          const actualRefs = (await client.query<Reference>(referenceSql)).rows;
          if (JSON.stringify(actualRefs) !== JSON.stringify(manifest.refs)) throw new Error("Restored file references differ");
        } finally { client.release(); }
      } finally { await restored.end(); }
    } finally {
      try {
        // Only the random database successfully created by this invocation can be dropped.
        if (owned) await admin.query(`DROP DATABASE ${ident(database)}`);
      } finally { await admin.end(); }
    }
    const verifiedAt = new Date().toISOString();
    throwIfStopped();
    await store.json(`${runPrefix(store.cfg, manifest.runId)}restore-${randomUUID()}.enc`, { version: 1, runId: manifest.runId, sourceId: store.cfg.sourceId, environment: store.cfg.environment, verifiedAt, status: "VERIFIED", tables: Object.keys(manifest.counts).length, files: manifest.refs.length });
    return { ok: true, verifiedAt, tables: Object.keys(manifest.counts).length, files: manifest.refs.length };
  });
}