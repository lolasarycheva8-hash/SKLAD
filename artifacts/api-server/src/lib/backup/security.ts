import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat, rm, writeFile, appendFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { operationSignal } from "./runtime";

const MAGIC = Buffer.from("WHBK0001");
export function encryptionKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) throw new Error("BACKUP_ENCRYPTION_KEY must be canonical base64 of 32 random bytes");
  return key;
}
export function seal(value: Buffer, key: Buffer, context: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([MAGIC, iv, body, cipher.getAuthTag()]);
}
export function unseal(value: Buffer, key: Buffer, context: string): Buffer {
  if (value.length < 36 || !value.subarray(0, 8).equals(MAGIC)) throw new Error("Invalid encrypted envelope");
  const cipher = createDecipheriv("aes-256-gcm", key, value.subarray(8, 20));
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(value.subarray(-16));
  return Buffer.concat([cipher.update(value.subarray(20, -16)), cipher.final()]);
}
export async function encryptFile(source: string, target: string, key: Buffer, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const hash = createHash("sha256");
  let bytes = 0;
  const meter = new Transform({ transform(chunk: Buffer, _encoding, done) { hash.update(chunk); bytes += chunk.length; done(null, chunk); } });
  await writeFile(target, Buffer.concat([MAGIC, iv]), { flag: "wx", mode: 0o600 });
  await pipeline(createReadStream(source), meter, cipher, createWriteStream(target, { flags: "a", mode: 0o600 }), { signal: operationSignal() });
  await appendFile(target, cipher.getAuthTag());
  return { sha256: hash.digest("hex"), bytes };
}
export async function decryptFile(source: string, target: string, key: Buffer, context: string, expected: { sha256: string; bytes: number }) {
  const size = (await stat(source)).size;
  if (size < 36) throw new Error("Truncated envelope");
  const file = await open(source, "r");
  const header = Buffer.alloc(20), tag = Buffer.alloc(16);
  try { await file.read(header, 0, 20, 0); await file.read(tag, 0, 16, size - 16); } finally { await file.close(); }
  if (!header.subarray(0, 8).equals(MAGIC)) throw new Error("Invalid envelope");
  const cipher = createDecipheriv("aes-256-gcm", key, header.subarray(8));
  cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(tag);
  const hash = createHash("sha256");
  let bytes = 0;
  const meter = new Transform({ transform(chunk: Buffer, _encoding, done) { hash.update(chunk); bytes += chunk.length; done(null, chunk); } });
  try {
    await pipeline(size === 36 ? Readable.from([]) : createReadStream(source, { start: 20, end: size - 17 }), cipher, meter, createWriteStream(target, { flags: "wx", mode: 0o600 }), { signal: operationSignal() });
    if (hash.digest("hex") !== expected.sha256 || bytes !== expected.bytes) throw new Error("Plaintext hash/size mismatch");
  } catch (error) { await rm(target, { force: true }); throw error; }
}
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export function validateConnectionUrl(value: string) {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1) || url.hash) throw new Error("Explicit PostgreSQL host/database URL required");
  const allowed = new Set(["sslmode", "sslrootcert", "sslcert", "sslkey", "channel_binding"]);
  for (const [name] of url.searchParams) {
    if (!allowed.has(name) || url.searchParams.getAll(name).length !== 1) throw new Error("Unsupported PostgreSQL connection option");
  }
  return url;
}
export function fresh(snapshotStartedAt: string, now = Date.now()): boolean {
  const age = now - Date.parse(snapshotStartedAt);
  return Number.isFinite(age) && age >= 0 && age <= MAX_AGE_MS;
}
export function restoreGuard(source: string, restore: string, allowed: string | undefined) {
  const a = validateConnectionUrl(source), b = validateConnectionUrl(restore);
  if (allowed !== "true") throw new Error("Restore requires BACKUP_RESTORE_ALLOW_ISOLATED=true");
  // Deliberately stricter than host+database equality: never restore anywhere on the source host.
  if (a.hostname.toLowerCase() === b.hostname.toLowerCase()) throw new Error("Restore host must differ from source host");
  if (decodeURIComponent(a.pathname) === decodeURIComponent(b.pathname)) throw new Error("Restore admin database must differ from source database");
  return b;
}