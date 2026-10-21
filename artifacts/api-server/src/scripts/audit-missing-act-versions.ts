import { readFile } from "node:fs/promises";

import type { BucketMetadata, File } from "@google-cloud/storage";

const REPORT_PATH = ".local/state/act-recovery/storage-audit-report.json";
const REGISTERED_UUID_PATH =
  /^\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface PriorAuditEntry {
  objectPath: string;
  refusal: string | null;
}

function objectKey(file: File): string {
  return `${file.bucket.name}\0${file.name}`;
}

function isPermissionDenied(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  return code === 401 || code === 403 || code === "401" || code === "403";
}

function groupFiles(files: File[]) {
  const groups = new Map<
    string,
    { example: File; prefix: string; names: Set<string> }
  >();
  for (const file of files) {
    const slash = file.name.lastIndexOf("/");
    const prefix = slash < 0 ? "" : file.name.slice(0, slash + 1);
    const key = `${file.bucket.name}\0${prefix}`;
    const existing = groups.get(key);
    if (existing) {
      existing.names.add(file.name);
    } else {
      groups.set(key, {
        example: file,
        prefix,
        names: new Set([file.name]),
      });
    }
  }
  return groups;
}

async function listExact(files: File[], versions: boolean): Promise<File[]> {
  const matches: File[] = [];
  for (const { example, prefix, names } of groupFiles(files).values()) {
    const [listed] = await example.bucket.getFiles({
      prefix,
      ...(versions ? { versions: true } : {}),
    });
    matches.push(...listed.filter((candidate) => names.has(candidate.name)));
  }
  return matches;
}

async function main(): Promise<void> {
  let permissionDeniedCount = 0;
  let failureCount = 0;
  try {
    const report: unknown = JSON.parse(await readFile(REPORT_PATH, "utf8"));
    if (
      typeof report !== "object" ||
      report === null ||
      !("complete" in report) ||
      report.complete !== true ||
      !("entries" in report) ||
      !Array.isArray(report.entries)
    ) {
      throw new Error("complete recovery audit report required");
    }
    const noCandidateEntries = (report.entries as PriorAuditEntry[]).filter(
      (entry) => entry.refusal === "no-soft-deleted-candidate",
    );
    if (
      noCandidateEntries.length === 0 ||
      noCandidateEntries.some(
        (entry) =>
          typeof entry.objectPath !== "string" ||
          !REGISTERED_UUID_PATH.test(entry.objectPath),
      )
    ) {
      throw new Error("valid no-candidate UUID paths required");
    }

    const { ObjectStorageService } = await import("../lib/objectStorage");
    const storage = new ObjectStorageService();
    const resolved = await Promise.all(
      noCandidateEntries.map((entry) =>
        storage.getObjectEntityFile(entry.objectPath, false),
      ),
    );
    const [live, versions] = await Promise.all([
      listExact(resolved, false),
      listExact(resolved, true),
    ]);
    const liveKeys = new Set(live.map(objectKey));
    const versionCounts = new Map<string, number>();
    for (const file of versions) {
      const key = objectKey(file);
      versionCounts.set(key, (versionCounts.get(key) ?? 0) + 1);
    }

    const bucketExamples = new Map<string, File>();
    for (const file of resolved) {
      bucketExamples.set(file.bucket.name, file);
    }
    const policies: Array<{
      versioningEnabled: boolean;
      softDeleteEnabled: boolean;
      softDeleteRetentionDurationSeconds: number | null;
    }> = [];
    for (const example of bucketExamples.values()) {
      let metadata: BucketMetadata;
      try {
        [metadata] = await example.bucket.getMetadata();
      } catch (error) {
        if (isPermissionDenied(error)) {
          permissionDeniedCount += 1;
          continue;
        }
        failureCount += 1;
        continue;
      }
      const typed = metadata as BucketMetadata;
      const rawDuration = typed.softDeletePolicy?.retentionDurationSeconds;
      const duration =
        typeof rawDuration === "string" || typeof rawDuration === "number"
          ? Number(rawDuration)
          : Number.NaN;
      const safeDuration =
        Number.isFinite(duration) && duration >= 0 ? duration : null;
      policies.push({
        versioningEnabled: typed.versioning?.enabled === true,
        softDeleteEnabled: safeDuration !== null && safeDuration > 0,
        softDeleteRetentionDurationSeconds: safeDuration,
      });
    }

    let pathsWithAnyVersion = 0;
    let pathsWithNoncurrentVersion = 0;
    let exactVersionGenerationCount = 0;
    let noncurrentGenerationCount = 0;
    for (const file of resolved) {
      const key = objectKey(file);
      const count = versionCounts.get(key) ?? 0;
      const liveGenerationCount = liveKeys.has(key) && count > 0 ? 1 : 0;
      const noncurrentCount = Math.max(0, count - liveGenerationCount);
      if (count > 0) pathsWithAnyVersion += 1;
      if (noncurrentCount > 0) pathsWithNoncurrentVersion += 1;
      exactVersionGenerationCount += count;
      noncurrentGenerationCount += noncurrentCount;
    }

    process.stdout.write(
      `${JSON.stringify({
        noSoftDeletedCandidateCount: resolved.length,
        liveNowCount: liveKeys.size,
        pathsWithAnyVersion,
        exactVersionGenerationCount,
        pathsWithNoncurrentVersion,
        noncurrentGenerationCount,
        genuinelyNoAvailableHistoricalGenerationCount:
          resolved.length - pathsWithNoncurrentVersion,
        bucketCount: policies.length,
        bucketMetadataUnavailableCount: bucketExamples.size - policies.length,
        policies,
        permissionDeniedCount,
        failureCount,
      })}\n`,
    );
  } catch (error) {
    if (isPermissionDenied(error)) {
      permissionDeniedCount += 1;
    } else {
      failureCount += 1;
    }
    process.stdout.write(
      `${JSON.stringify({ permissionDeniedCount, failureCount })}\n`,
    );
    process.exitCode = 1;
  }
}

void main();
