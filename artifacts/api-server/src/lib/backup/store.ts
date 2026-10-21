import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { Config } from "./config";
import { seal, unseal } from "./security";
import { operationSignal } from "./runtime";

export class BackupStore {
  readonly client: S3Client;
  constructor(readonly cfg: Config) {
    this.client = new S3Client({ endpoint: cfg.endpoint, region: cfg.region, credentials: cfg.credentials, forcePathStyle: true, maxAttempts: 3, requestHandler: { connectionTimeout: 15_000, requestTimeout: 120_000 } });
  }
  async json(key: string, value: unknown) {
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: seal(Buffer.from(JSON.stringify(value)), this.cfg.key, key), IfNoneMatch: "*", ContentType: "application/octet-stream" }), { abortSignal: operationSignal() });
  }
  async readJson<T>(key: string): Promise<T> {
    const signal = operationSignal();
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }), { abortSignal: signal });
    if (!response.Body || !response.ContentLength || response.ContentLength > 64 * 1024 * 1024) throw new Error("Manifest absent or too large");
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of response.Body as Readable) {
      signal.throwIfAborted();
      bytes += chunk.length;
      if (bytes > 64 * 1024 * 1024) throw new Error("Manifest body exceeded limit");
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(unseal(Buffer.concat(chunks), this.cfg.key, key).toString("utf8")) as T;
  }
  async upload(key: string, path: string) {
    const input = createReadStream(path);
    const abortController = new AbortController();
    const signal = operationSignal(10 * 60_000);
    signal.throwIfAborted();
    const abort = () => { abortController.abort(); input.destroy(); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      await new Upload({ client: this.client, params: { Bucket: this.cfg.bucket, Key: key, Body: input }, queueSize: 2, partSize: 8 * 1024 * 1024, leavePartsOnError: false, abortController }).done();
    } finally { signal.removeEventListener("abort", abort); input.destroy(); }
  }
  async download(key: string, path: string) {
    const signal = operationSignal();
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }), { abortSignal: signal });
    if (!response.Body) throw new Error("Backup item missing");
    await pipeline(response.Body as Readable, createWriteStream(path, { flags: "wx", mode: 0o600 }), { signal });
  }
  async exists(key: string) {
    await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }), { abortSignal: operationSignal() });
  }
  async list(suffix: string) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: this.cfg.prefix, ContinuationToken: token }), { abortSignal: operationSignal() });
      for (const item of page.Contents || []) if (item.Key?.endsWith(suffix)) keys.push(item.Key);
      token = page.NextContinuationToken;
    } while (token);
    return keys.sort().reverse();
  }
}