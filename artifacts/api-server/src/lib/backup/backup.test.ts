import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { encryptionKey, seal, unseal, encryptFile, decryptFile, fresh, MAX_AGE_MS, restoreGuard } from "./security";
import { config } from "./config";
import { complete, health, latestComplete, recentKnownMissing, type Manifest } from "./operations";
import { publicAddress } from "./notify";
import type { BackupStore } from "./store";
import { bounded, deadlineMinutes } from "./runtime";

test("key is canonical 256-bit; envelope rejects wrong key, modified ciphertext, tag and context", () => {
  const key = randomBytes(32), encrypted = seal(Buffer.from("private manifest"), key, "manifest");
  assert.deepEqual(encryptionKey(key.toString("base64")), key);
  for (const value of ["", "x", randomBytes(31).toString("base64"), key.toString("base64") + "\n"]) assert.throws(() => encryptionKey(value));
  assert.equal(unseal(encrypted, key, "manifest").toString(), "private manifest");
  assert.throws(() => unseal(encrypted, randomBytes(32), "manifest"));
  assert.throws(() => unseal(encrypted, key, "different-run"));
  for (const offset of [0, 8, 20, encrypted.length - 1]) {
    const corrupted = Buffer.from(encrypted); corrupted[offset] ^= 1;
    assert.throws(() => unseal(corrupted, key, "manifest"));
  }
  assert.notDeepEqual(seal(Buffer.from("same"), key, "x"), seal(Buffer.from("same"), key, "x"));
});

for (const name of ["dump", "file", "empty"]) test(`${name} streams roundtrip; corruption fails closed and deletes plaintext`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "backup-test-"));
  try {
    const key = randomBytes(32), plain = join(dir, "plain"), encrypted = join(dir, "enc"), restored = join(dir, "restored");
    const data = name === "empty" ? Buffer.alloc(0) : randomBytes(256 * 1024);
    await writeFile(plain, data, { mode: 0o600 });
    const integrity = await encryptFile(plain, encrypted, key, name);
    assert.equal((await stat(encrypted)).mode & 0o777, 0o600);
    await decryptFile(encrypted, restored, key, name, integrity);
    assert.deepEqual(await readFile(restored), data);
    await rm(restored);
    const bytes = await readFile(encrypted); bytes[bytes.length - 1] ^= 1;
    await writeFile(encrypted, bytes);
    await assert.rejects(decryptFile(encrypted, restored, key, name, integrity));
    await assert.rejects(stat(restored));
    await rm(encrypted);
    await encryptFile(plain, encrypted, key, name);
    await assert.rejects(decryptFile(encrypted, restored, key, name, { ...integrity, sha256: "0".repeat(64) }));
    await assert.rejects(stat(restored));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("health age uses snapshot start, never upload completion, refuses future and invalid time", () => {
  const now = Date.now();
  assert.equal(fresh(new Date(now - MAX_AGE_MS).toISOString(), now), true);
  assert.equal(fresh(new Date(now - MAX_AGE_MS - 1).toISOString(), now), false);
  assert.equal(fresh(new Date(now + 1).toISOString(), now), false);
  assert.equal(fresh("invalid", now), false);
});
test("restore requires explicit isolated authorization and rejects same host or database", () => {
  const source = "postgres://a:b@source.example/live";
  assert.throws(() => restoreGuard(source, "postgres://a:b@target.example/admin", undefined));
  assert.throws(() => restoreGuard(source, "postgres://a:b@source.example/admin", "true"));
  assert.throws(() => restoreGuard(source, "postgres://a:b@target.example/live", "true"));
  assert.throws(() => restoreGuard(source, "postgres://a:b@target.example/admin?host=source.example", "true"));
  assert.throws(() => restoreGuard(source, "postgres://a:b@target.example/admin?options=-csearch_path=public", "true"));
  assert.equal(restoreGuard(source, "postgres://a:b@target.example/admin", "true").hostname, "target.example");
});
const runId = "2026-06-01T00-00-00.000Z_11111111-1111-4111-8111-111111111111";
const prefix = `warehouse/test-warehouse/development/${runId}/`;
const id = "22222222-2222-4222-8222-222222222222";
const testKey = randomBytes(32);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture(): Manifest {
  return { version: 1, runId, sourceId: "test-warehouse", environment: "development", snapshotStartedAt: new Date().toISOString(),
    source: { host: "source", port: "5432", database: "warehouse" }, status: "COMPLETE", counts: { '"public"."delivery_photos"': "1" },
    schema: { columns: [], constraints: [], indexes: [] },
    refs: [{ id, object_path: "/objects/uploads/file", file_name: "act", mime_type: "image/jpeg" }],
    files: { [id]: { key: `${prefix}files/${id}.enc`, sha256: digest("file"), bytes: 4 } },
    missing: [], dump: { key: `${prefix}dump.enc`, sha256: digest("dump"), bytes: 4 } };
}
function simulated(manifest: Manifest, latest = runId) {
  return {
    cfg: { prefix: "warehouse/test-warehouse/development/", sourceId: "test-warehouse", environment: "development", source: "postgres://user@source/warehouse", key: testKey },
    async list(suffix: string) { return [suffix === "/complete.enc" ? `${prefix}complete.enc` : `warehouse/test-warehouse/development/${latest}/started.enc`]; },
    async readJson(key: string) {
      if (key.endsWith("/complete.enc")) return { runId, sourceId: "test-warehouse", environment: "development", manifest: `${prefix}manifest.enc` };
      if (key.endsWith("/started.enc")) return { runId: latest, sourceId: "test-warehouse", environment: "development" };
      return manifest;
    },
    async exists() {},
    async download(key: string, path: string) { await writeFile(path, seal(Buffer.from(key.endsWith("dump.enc") ? "dump" : "file"), testKey, key), { flag: "wx", mode: 0o600 }); },
  } as unknown as BackupStore;
}
test("missing references and incomplete status cannot be promoted by completion markers", async () => {
  const manifest = fixture();
  assert.equal(complete(manifest), true);
  delete manifest.files[id];
  assert.equal(complete(manifest), false);
  await assert.rejects(latestComplete(simulated(manifest)), /Incomplete/);
  const missing = fixture(); missing.missing = [id];
  assert.equal(complete(missing), false);
  const incomplete = fixture(); incomplete.status = "INCOMPLETE";
  await assert.rejects(latestComplete(simulated(incomplete)), /Incomplete/);
});
test("health fails latest incomplete attempt even with a previous fresh complete copy", async () => {
  const manifest = fixture();
  assert.equal((await health(simulated(manifest))).ok, true);
  await assert.rejects(health(simulated(manifest, runId.replace("11111111", "33333333"))), /incomplete/);
  manifest.snapshotStartedAt = new Date(Date.now() - MAX_AGE_MS - 1000).toISOString();
  await assert.rejects(health(simulated(manifest)), /stale/);
});
test("health rejects a different cluster port and accepts normalized default port", async () => {
  const manifest = fixture();
  assert.equal((await health(simulated(manifest))).ok, true);
  manifest.source.port = "5433";
  await assert.rejects(health(simulated(manifest)), /source host\/port\/database/);
});
test("health authenticates marker and manifest and checks item presence", async () => {
  const store = simulated(fixture());
  store.readJson = async () => { throw new Error("authentication failed"); };
  await assert.rejects(health(store), /authentication/);
  const absent = simulated(fixture());
  absent.download = async () => { throw new Error("missing item"); };
  await assert.rejects(health(absent), /missing item/);
});
test("health fully authenticates payload bodies, not HEAD presence", async () => {
  for (const damaged of ["dump.enc", `files/${id}.enc`]) {
    const store = simulated(fixture()), original = store.download.bind(store);
    store.download = async (key, path) => {
      await original(key, path);
      if (key.endsWith(damaged)) {
        const bytes = await readFile(path); bytes[bytes.length - 1] ^= 1;
        await writeFile(path, bytes);
      }
    };
    await assert.rejects(health(store));
  }
});
test("health rejects different project or changed current database; historical restore retains source ID", async () => {
  const project = fixture(); project.sourceId = "another-project";
  await assert.rejects(latestComplete(simulated(project)), /Invalid/);
  const source = fixture(); source.source.host = "wrong-host";
  await assert.rejects(health(simulated(source)), /source host/);
  assert.equal((await latestComplete(simulated(source), false)).source.host, "wrong-host");
});
test("known-missing incomplete salvage is captured daily, never waived healthy; transient failures retry", async () => {
  const manifest = fixture();
  manifest.status = "INCOMPLETE"; manifest.failureReason = "MISSING_REFERENCES"; manifest.missing = [id];
  delete manifest.files[id];
  const store = simulated(manifest), now = Date.now();
  manifest.snapshotStartedAt = new Date(now - 3600_000).toISOString();
  assert.equal(await recentKnownMissing(store, now), true);
  await assert.rejects(health(store), /Incomplete/);
  manifest.snapshotStartedAt = new Date(now - 23 * 3600_000).toISOString();
  assert.equal(await recentKnownMissing(store, now), false);
  manifest.snapshotStartedAt = new Date(now).toISOString(); manifest.failureReason = "ACQUISITION_FAILED";
  assert.equal(await recentKnownMissing(store, now), false);
});
test("explicit environment and production runtime matching are mandatory", () => {
  const env = { NODE_ENV: "development", BACKUP_SOURCE_ENVIRONMENT: "production" };
  assert.throws(() => config(env), /NODE_ENV/);
  assert.throws(() => config({}), /BACKUP_SOURCE_ENVIRONMENT/);
});
test("webhook disallows private, loopback, link-local and mapped private addresses", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.1.1", "192.168.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fc00::1"]) assert.equal(publicAddress(ip), false);
  assert.equal(publicAddress("8.8.8.8"), true);
});
test("deadline is bounded and accepts only whole minutes", async () => {
  for (const value of ["0", "91", "Infinity", "NaN", "1.5"]) assert.throws(() => deadlineMinutes(value));
  assert.equal(deadlineMinutes("30"), 30);
  assert.equal(await bounded(Promise.resolve("done"), 100), "done");
  // Keep the test event loop alive while the intentionally unref'ed AbortSignal timer expires.
  const keepAlive = setTimeout(() => {}, 100);
  try { await assert.rejects(bounded(new Promise(() => {}), 5), /timed out/); }
  finally { clearTimeout(keepAlive); }
});