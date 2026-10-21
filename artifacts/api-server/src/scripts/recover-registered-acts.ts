import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { File, FileMetadata } from "@google-cloud/storage";

const ALLOWLIST_PATH = ".local/state/act-recovery/registered-paths.json";
const REPORT_PATH = ".local/state/act-recovery/storage-audit-report.json";
const REGISTERED_UUID_PATH =
  /^\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface CandidateMetadata {
  generation: string;
  restoreToken: string | null;
  softDeleteTime: string | null;
  hardDeleteTime: string | null;
  retained: boolean;
}

interface AuditEntry {
  objectPath: string;
  live: boolean;
  softDeletedCandidates: CandidateMetadata[];
  eligibleForRestore: boolean;
  refusal:
    | null
    | "live-object-exists"
    | "no-soft-deleted-candidate"
    | "ambiguous-soft-deleted-candidates"
    | "candidate-not-confirmed-within-retention"
    | "invalid-generation";
}

interface CliOptions {
  restore: boolean;
  onlyPath?: string;
}

function parseOptions(args: string[]): CliOptions {
  let restore = false;
  let onlyPath: string | undefined;
  for (const arg of args) {
    if (arg === "--restore") restore = true;
    else if (arg.startsWith("--only=")) onlyPath = arg.slice("--only=".length);
    else throw new Error("unsupported argument");
  }
  if (onlyPath !== undefined && !REGISTERED_UUID_PATH.test(onlyPath)) {
    throw new Error("--only must be an exact registered UUID object path");
  }
  return { restore, onlyPath };
}

function errorCode(error: unknown): string | number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" || typeof error.code === "number"
    ? error.code
    : undefined;
}

function isPermissionDenied(error: unknown): boolean {
  const code = errorCode(error);
  return code === 401 || code === 403 || code === "401" || code === "403";
}

async function loadAllowlist(onlyPath?: string): Promise<string[]> {
  const parsed: unknown = JSON.parse(await readFile(ALLOWLIST_PATH, "utf8"));
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some(
      (value) => typeof value !== "string" || !REGISTERED_UUID_PATH.test(value),
    )
  ) {
    throw new Error("allowlist must contain only exact registered UUID paths");
  }
  const unique = [...new Set(parsed)];
  if (unique.length !== parsed.length) {
    throw new Error("allowlist contains duplicate paths");
  }
  if (!onlyPath) return unique;
  if (!unique.includes(onlyPath)) {
    throw new Error("known path is absent from allowlist");
  }
  return [onlyPath];
}

function groupingKey(file: File): { key: string; prefix: string } {
  const slash = file.name.lastIndexOf("/");
  const prefix = slash < 0 ? "" : file.name.slice(0, slash + 1);
  return { key: `${file.bucket.name}\0${prefix}`, prefix };
}

function objectKey(file: File): string {
  return `${file.bucket.name}\0${file.name}`;
}

async function bulkListExact(
  files: File[],
  softDeleted: boolean,
): Promise<File[]> {
  const groups = new Map<
    string,
    { example: File; prefix: string; names: Set<string> }
  >();
  for (const file of files) {
    const { key, prefix } = groupingKey(file);
    const group = groups.get(key);
    if (group) {
      group.names.add(file.name);
    } else {
      groups.set(key, {
        example: file,
        prefix,
        names: new Set([file.name]),
      });
    }
  }

  const exactMatches: File[] = [];
  for (const { example, prefix, names } of groups.values()) {
    const [listed] = await example.bucket.getFiles({
      prefix,
      ...(softDeleted ? { softDeleted: true } : {}),
    });
    exactMatches.push(
      ...listed.filter((candidate) => names.has(candidate.name)),
    );
  }
  return exactMatches;
}

function candidateMetadata(file: File, now: number): CandidateMetadata {
  const metadata = file.metadata as FileMetadata;
  const generation =
    typeof metadata.generation === "string" ||
    typeof metadata.generation === "number"
      ? String(metadata.generation)
      : "";
  const restoreToken =
    typeof metadata.restoreToken === "string" ? metadata.restoreToken : null;
  const softDeleteTime =
    typeof metadata.softDeleteTime === "string"
      ? metadata.softDeleteTime
      : null;
  const hardDeleteTime =
    typeof metadata.hardDeleteTime === "string"
      ? metadata.hardDeleteTime
      : null;
  const hardDeleteAt =
    hardDeleteTime === null ? Number.NaN : Date.parse(hardDeleteTime);
  return {
    generation,
    restoreToken,
    softDeleteTime,
    hardDeleteTime,
    retained: Number.isFinite(hardDeleteAt) && hardDeleteAt > now,
  };
}

function classifyEntry(
  objectPath: string,
  live: boolean,
  candidates: CandidateMetadata[],
): AuditEntry {
  let refusal: AuditEntry["refusal"] = null;
  if (live) refusal = "live-object-exists";
  else if (candidates.length === 0) refusal = "no-soft-deleted-candidate";
  else if (candidates.length !== 1) {
    refusal = "ambiguous-soft-deleted-candidates";
  } else if (!candidates[0].retained) {
    refusal = "candidate-not-confirmed-within-retention";
  } else {
    const generation = Number(candidates[0].generation);
    if (
      !Number.isSafeInteger(generation) ||
      generation <= 0 ||
      String(generation) !== candidates[0].generation
    ) {
      refusal = "invalid-generation";
    }
  }
  return {
    objectPath,
    live,
    softDeletedCandidates: candidates,
    eligibleForRestore: refusal === null,
    refusal,
  };
}

async function writePrivateReport(report: unknown): Promise<void> {
  await mkdir(dirname(REPORT_PATH), { recursive: true, mode: 0o700 });
  const temporaryPath = `${REPORT_PATH}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, REPORT_PATH);
}

async function main(): Promise<void> {
  let permissionDeniedCount = 0;
  let failureCount = 0;
  let restoredCount = 0;
  let verificationFailureCount = 0;
  try {
    const options = parseOptions(process.argv.slice(2));
    const objectPaths = await loadAllowlist(options.onlyPath);
    const { ObjectStorageService } = await import("../lib/objectStorage");
    const storage = new ObjectStorageService();
    const resolved = await Promise.all(
      objectPaths.map((path) => storage.getObjectEntityFile(path, false)),
    );

    let liveFiles: File[];
    let softDeletedFiles: File[];
    try {
      [liveFiles, softDeletedFiles] = await Promise.all([
        bulkListExact(resolved, false),
        bulkListExact(resolved, true),
      ]);
    } catch (error) {
      if (isPermissionDenied(error)) permissionDeniedCount += 1;
      else failureCount += 1;
      await writePrivateReport({
        mode: options.restore ? "restore" : "preview",
        complete: false,
        allowlistedCount: objectPaths.length,
        permissionDeniedCount,
        failureCount,
      });
      process.stdout.write(
        `${JSON.stringify({
          allowlistedCount: objectPaths.length,
          auditedCount: 0,
          permissionDeniedCount,
          failureCount,
        })}\n`,
      );
      process.exitCode = 1;
      return;
    }

    const liveNames = new Set(liveFiles.map(objectKey));
    const softDeletedByName = new Map<string, File[]>();
    for (const file of softDeletedFiles) {
      const key = objectKey(file);
      const candidates = softDeletedByName.get(key);
      if (candidates) candidates.push(file);
      else softDeletedByName.set(key, [file]);
    }
    const now = Date.now();
    const entries = objectPaths.map((objectPath, index) => {
      const resolvedFile = resolved[index];
      const candidates = (
        softDeletedByName.get(objectKey(resolvedFile)) ?? []
      ).map((file) => candidateMetadata(file, now));
      return classifyEntry(
        objectPath,
        liveNames.has(objectKey(resolvedFile)),
        candidates,
      );
    });

    await writePrivateReport({
      mode: options.restore ? "restore" : "preview",
      complete: true,
      createdAt: new Date(now).toISOString(),
      allowlistedCount: objectPaths.length,
      entries,
    });

    if (options.restore) {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (!entry.eligibleForRestore) continue;
        const candidate = entry.softDeletedCandidates[0];
        const generation = Number(candidate.generation);
        try {
          await resolved[index].restore({
            generation,
            ...(candidate.restoreToken === null
              ? {}
              : { restoreToken: candidate.restoreToken }),
            ifGenerationMatch: 0,
            projection: "noAcl",
          });
          const [exists] = await resolved[index].exists();
          if (exists) restoredCount += 1;
          else verificationFailureCount += 1;
        } catch (error) {
          if (isPermissionDenied(error)) permissionDeniedCount += 1;
          else failureCount += 1;
        }
      }
    }

    const summary = {
      allowlistedCount: objectPaths.length,
      auditedCount: entries.length,
      liveCount: entries.filter((entry) => entry.live).length,
      softDeletedCandidateCount: entries.reduce(
        (total, entry) => total + entry.softDeletedCandidates.length,
        0,
      ),
      eligibleForRestoreCount: entries.filter(
        (entry) => entry.eligibleForRestore,
      ).length,
      ambiguousCount: entries.filter(
        (entry) => entry.refusal === "ambiguous-soft-deleted-candidates",
      ).length,
      noCandidateCount: entries.filter(
        (entry) => entry.refusal === "no-soft-deleted-candidate",
      ).length,
      outsideOrUnknownRetentionCount: entries.filter(
        (entry) => entry.refusal === "candidate-not-confirmed-within-retention",
      ).length,
      invalidGenerationCount: entries.filter(
        (entry) => entry.refusal === "invalid-generation",
      ).length,
      restoredCount,
      verificationFailureCount,
      permissionDeniedCount,
      failureCount,
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (
      permissionDeniedCount > 0 ||
      failureCount > 0 ||
      verificationFailureCount > 0
    ) {
      process.exitCode = 1;
    }
  } catch (error) {
    if (isPermissionDenied(error)) permissionDeniedCount += 1;
    else failureCount += 1;
    process.stdout.write(
      `${JSON.stringify({ permissionDeniedCount, failureCount })}\n`,
    );
    process.exitCode = 1;
  }
}

void main();
