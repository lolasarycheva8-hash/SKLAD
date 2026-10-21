import type { File, FileMetadata } from "@google-cloud/storage";

const KNOWN_OBJECT_PATH = process.argv[2];
if (!KNOWN_OBJECT_PATH || !/^\/objects\/uploads\/[0-9a-f-]{36}$/.test(KNOWN_OBJECT_PATH)) {
  throw new Error("Pass an exact /objects/uploads/<UUID> path to diagnose.");
}

type PermissionFailure = {
  operation: string;
  permissionDenied: true;
};

type ListedObject = {
  softDeleteTime: string | null;
  hardDeleteTime: string | null;
};

function errorCode(error: unknown): number | string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === "number" || typeof code === "string"
    ? code
    : undefined;
}

function isPermissionDenied(error: unknown): boolean {
  const code = errorCode(error);
  return code === 401 || code === 403 || code === "401" || code === "403";
}

function safeFailure(operation: string, error: unknown): never {
  if (isPermissionDenied(error)) {
    throw Object.assign(new Error("permission denied"), {
      safeDiagnostic: {
        operation,
        permissionDenied: true,
      } satisfies PermissionFailure,
    });
  }
  throw Object.assign(new Error("storage diagnostic failed"), {
    safeDiagnostic: {
      operation,
      permissionDenied: false,
      code: errorCode(error) ?? "unknown",
    },
  });
}

function selectedMetadata(file: File): ListedObject {
  const metadata = file.metadata as FileMetadata;
  return {
    softDeleteTime:
      typeof metadata.softDeleteTime === "string"
        ? metadata.softDeleteTime
        : null,
    hardDeleteTime:
      typeof metadata.hardDeleteTime === "string"
        ? metadata.hardDeleteTime
        : null,
  };
}

function recoverySummary(objects: ListedObject[], now = Date.now()) {
  let withinRetention = 0;
  let pastRetention = 0;
  let retentionUnknown = 0;
  for (const object of objects) {
    if (object.hardDeleteTime === null) {
      retentionUnknown += 1;
      continue;
    }
    const hardDeleteAt = Date.parse(object.hardDeleteTime);
    if (!Number.isFinite(hardDeleteAt)) {
      retentionUnknown += 1;
    } else if (hardDeleteAt > now) {
      withinRetention += 1;
    } else {
      pastRetention += 1;
    }
  }
  return {
    listedSoftDeletedCount: objects.length,
    withinRetention,
    pastRetention,
    retentionUnknown,
    recoveryAvailability:
      objects.length === 0
        ? "no-soft-deleted-candidate-listed"
        : withinRetention > 0
          ? "soft-deleted-candidate-listed-within-retention"
          : retentionUnknown > 0
            ? "soft-deleted-candidate-listed-retention-unknown"
            : "listed-candidate-past-retention",
  };
}

async function listExact(
  file: File,
  mode: "softDeleted" | "versions",
): Promise<File[]> {
  try {
    const [listed] = await file.bucket.getFiles({
      prefix: file.name,
      ...(mode === "softDeleted" ? { softDeleted: true } : { versions: true }),
    });
    return listed.filter((candidate) => candidate.name === file.name);
  } catch (error) {
    return safeFailure(`known-${mode}-list`, error);
  }
}

async function listRegistered(
  files: File[],
  mode: "live" | "softDeleted" | "versions",
): Promise<File[]> {
  const groups = new Map<
    string,
    { example: File; prefix: string; names: Set<string> }
  >();
  for (const file of files) {
    const slash = file.name.lastIndexOf("/");
    const prefix = slash < 0 ? "" : file.name.slice(0, slash + 1);
    const key = `${file.bucket.name}\0${prefix}`;
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

  const matches: File[] = [];
  for (const { example, prefix, names } of groups.values()) {
    let listed: File[];
    try {
      [listed] = await example.bucket.getFiles({
        prefix,
        ...(mode === "softDeleted"
          ? { softDeleted: true }
          : mode === "versions"
            ? { versions: true }
            : {}),
      });
    } catch (error) {
      return safeFailure(`registered-${mode}-list`, error);
    }
    matches.push(...listed.filter((candidate) => names.has(candidate.name)));
  }
  return matches;
}

async function main(): Promise<void> {
  let pool: { end: () => Promise<void> } | undefined;
  try {
    const {
      db,
      deliveryPhotosTable,
      pool: dbPool,
    } = await import("@workspace/db");
    const { ObjectStorageService } = await import("../lib/objectStorage");
    pool = dbPool;
    const storage = new ObjectStorageService();

    // Resolve through the production service path mapper. Passing false avoids
    // turning a missing live generation into an exception.
    const knownFile = await storage.getObjectEntityFile(
      KNOWN_OBJECT_PATH,
      false,
    );

    let knownLiveExists: boolean;
    try {
      [knownLiveExists] = await knownFile.exists();
    } catch (error) {
      return safeFailure("known-live-exists", error);
    }

    // The client types document that softDeleted and versions are mutually
    // exclusive, so both required views are queried separately.
    const [knownSoftDeleted, knownVersions] = await Promise.all([
      listExact(knownFile, "softDeleted"),
      listExact(knownFile, "versions"),
    ]);

    const rows = await db
      .select({ objectPath: deliveryPhotosTable.objectPath })
      .from(deliveryPhotosTable);
    const uniqueRegisteredPaths = [
      ...new Set(rows.map((row) => row.objectPath)),
    ];
    const registeredFiles: File[] = [];
    let invalidRegisteredPathCount = 0;
    for (const objectPath of uniqueRegisteredPaths) {
      try {
        registeredFiles.push(
          await storage.getObjectEntityFile(objectPath, false),
        );
      } catch {
        invalidRegisteredPathCount += 1;
      }
    }

    const [registeredLive, registeredSoftDeleted, registeredVersions] =
      await Promise.all([
        listRegistered(registeredFiles, "live"),
        listRegistered(registeredFiles, "softDeleted"),
        listRegistered(registeredFiles, "versions"),
      ]);

    const knownSoftDeleteTimes = knownSoftDeleted.map(selectedMetadata);
    const registeredSoftDeleteTimes =
      registeredSoftDeleted.map(selectedMetadata);
    const knownRegisteredInCurrentDatabase =
      uniqueRegisteredPaths.includes(KNOWN_OBJECT_PATH);

    process.stdout.write(
      `${JSON.stringify(
        {
          knownObject: {
            liveExists: knownLiveExists,
            registeredInCurrentDatabase: knownRegisteredInCurrentDatabase,
            exactSoftDeletedQuery: {
              exactMatchCount: knownSoftDeleted.length,
              deletionAndRetentionTimes: knownSoftDeleteTimes,
              ...recoverySummary(knownSoftDeleteTimes),
            },
            exactVersionsQuery: {
              exactMatchCount: knownVersions.length,
            },
          },
          currentDatabaseRegisteredObjects: {
            rowCount: rows.length,
            uniquePathCount: uniqueRegisteredPaths.length,
            resolvedPathCount: registeredFiles.length,
            invalidPathCount: invalidRegisteredPathCount,
            liveExactMatchCount: new Set(
              registeredLive.map((file) => file.name),
            ).size,
            versionsExactMatchCount: registeredVersions.length,
            softDeletedExactMatchCount: registeredSoftDeleted.length,
            deletionAndRetentionTimes: registeredSoftDeleteTimes,
            ...recoverySummary(registeredSoftDeleteTimes),
          },
          permissionDenied: [],
          limits: [
            "Current environment storage mapping and database were inspected only.",
            "A current-environment match or miss does not prove that the production private prefix is the same.",
            "Listing a retained soft-deleted generation identifies a recovery candidate but does not test restore permission or perform a restore.",
            "softDeleted and versions were listed in separate requests because the installed client documents them as mutually exclusive.",
          ],
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    const safeDiagnostic =
      typeof error === "object" && error !== null && "safeDiagnostic" in error
        ? error.safeDiagnostic
        : {
            operation: "database-or-path-resolution",
            permissionDenied: isPermissionDenied(error),
            code: errorCode(error) ?? "unknown",
          };
    process.stdout.write(
      `${JSON.stringify({
        completed: false,
        failure: safeDiagnostic,
      })}\n`,
    );
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
}

void main();
