import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

import {
  acquireDeliveryUploadLock,
  releaseDeliveryUploadCleanupSessionLock,
  tryAcquireDeliveryUploadCleanupSessionLock,
} from "./delivery-upload-lock";
import {
  reconcileDeliveryUploads,
  type DeliveryUploadObject,
  type ReconciliationEvent,
  type ReconciliationSummary,
} from "./reconcile-delivery-uploads";

export const DEFAULT_DELIVERY_UPLOAD_RETENTION_HOURS = 24;
export const DEFAULT_DELIVERY_UPLOAD_CLEANUP_INTERVAL_HOURS = 6;
export const DEFAULT_DELIVERY_UPLOAD_CLEANUP_INITIAL_DELAY_SECONDS = 60;

export interface DeliveryUploadCleanupConfig {
  retentionHours: number;
  intervalHours: number;
  initialDelaySeconds: number;
}

export interface CleanupLogger {
  info: (bindings: Record<string, unknown>, message: string) => void;
  debug: (bindings: Record<string, unknown>, message: string) => void;
  error: (bindings: Record<string, unknown>, message: string) => void;
}

function readPositiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = environment[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a finite integer greater than or equal to 1`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a finite integer greater than or equal to 1`);
  }
  return value;
}

export function getDeliveryUploadCleanupConfig(
  environment: NodeJS.ProcessEnv = process.env,
): DeliveryUploadCleanupConfig {
  return {
    retentionHours: readPositiveInteger(
      environment,
      "DELIVERY_UPLOAD_RETENTION_HOURS",
      DEFAULT_DELIVERY_UPLOAD_RETENTION_HOURS,
    ),
    intervalHours: readPositiveInteger(
      environment,
      "DELIVERY_UPLOAD_CLEANUP_INTERVAL_HOURS",
      DEFAULT_DELIVERY_UPLOAD_CLEANUP_INTERVAL_HOURS,
    ),
    initialDelaySeconds: readPositiveInteger(
      environment,
      "DELIVERY_UPLOAD_CLEANUP_INITIAL_DELAY_SECONDS",
      DEFAULT_DELIVERY_UPLOAD_CLEANUP_INITIAL_DELAY_SECONDS,
    ),
  };
}

type TransactionDatabase = {
  transaction: <T>(callback: (transaction: any) => Promise<T>) => Promise<T>;
  $client?: {
    connect: () => Promise<CleanupPoolClient>;
  };
};

type CleanupPoolClient = {
  query: (
    text: string,
    values: readonly unknown[],
  ) => Promise<{ rows: Array<{ acquired?: boolean; released?: boolean }> }>;
  release: (error?: Error | boolean) => void;
};

export interface LiveDeliveryUploadCleanupDependencies {
  db: TransactionDatabase;
  runWithGlobalCleanupLock: <T>(
    callback: (database: any) => Promise<T>,
  ) => Promise<T | null>;
  listUploads: () => Promise<DeliveryUploadObject[]>;
  listReferencedObjectPaths: (database: any) => Promise<Iterable<string>>;
  isObjectPathReferenced: (
    transaction: any,
    objectPath: string,
  ) => Promise<boolean>;
  deleteObject: (objectPath: string) => Promise<boolean>;
  resumePendingDeletions?: (
    database: any,
  ) => Promise<PendingDeletionResumeSummary>;
  logger: CleanupLogger;
}

export interface PendingDeletionResumeSummary {
  candidates: number;
  deleted: number;
  resumedPhotoDeletions: number;
  resumedDeliveryDeletions: number;
  raceSkipped: number;
  failed: number;
  failures: Array<{ objectPath: string; error: string }>;
}

export interface DeliveryUploadCleanupSummary extends ReconciliationSummary {
  resumedPhotoDeletions: number;
  resumedDeliveryDeletions: number;
}

const EMPTY_PENDING_DELETION_SUMMARY: PendingDeletionResumeSummary = {
  candidates: 0,
  deleted: 0,
  resumedPhotoDeletions: 0,
  resumedDeliveryDeletions: 0,
  raceSkipped: 0,
  failed: 0,
  failures: [],
};

function mergePendingDeletionSummary(
  reconciliation: ReconciliationSummary,
  pending: PendingDeletionResumeSummary,
): DeliveryUploadCleanupSummary {
  return {
    ...reconciliation,
    scanned: reconciliation.scanned + pending.candidates,
    candidates: reconciliation.candidates + pending.candidates,
    deleted: reconciliation.deleted + pending.deleted,
    resumedPhotoDeletions: pending.resumedPhotoDeletions,
    resumedDeliveryDeletions: pending.resumedDeliveryDeletions,
    raceSkipped: reconciliation.raceSkipped + pending.raceSkipped,
    failed: reconciliation.failed + pending.failed,
    failures: [...pending.failures, ...reconciliation.failures],
  };
}

function logEvent(logger: CleanupLogger, event: ReconciliationEvent): void {
  if (event.type === "failure") {
    logger.error(
      { objectPath: event.object.objectPath, error: event.error },
      "Delivery upload cleanup object deletion failed",
    );
  } else {
    logger.debug(
      { objectPath: event.object.objectPath, event: event.type },
      "Delivery upload cleanup object processed",
    );
  }
}

/**
 * Executes an actual cleanup run. The global advisory lock, reference reads,
 * path locks, rechecks, and object deletes all use one transaction connection.
 */
export async function runDeliveryUploadCleanup(
  dependencies: LiveDeliveryUploadCleanupDependencies,
  options: { minimumAgeHours?: number; dryRun?: boolean } = {},
): Promise<DeliveryUploadCleanupSummary | null> {
  const dryRun = options.dryRun ?? false;
  const execute = async (
    database: any,
  ): Promise<DeliveryUploadCleanupSummary> => {
    const pendingSummary =
      !dryRun && dependencies.resumePendingDeletions
        ? await dependencies.resumePendingDeletions(database)
        : EMPTY_PENDING_DELETION_SUMMARY;

    const uploads = await dependencies.listUploads();
    dependencies.logger.info(
      { event: "start", dryRun, minimumAgeHours: options.minimumAgeHours ?? 24 },
      "Delivery upload cleanup started",
    );
    const reconciliationSummary = await reconcileDeliveryUploads(
      {
        listUploads: async () => uploads,
        listReferencedObjectPaths: () =>
          dependencies.listReferencedObjectPaths(database),
        deleteIfUnreferenced: async (objectPath) => {
          return database.transaction(async (transaction: any) => {
            await acquireDeliveryUploadLock(transaction, objectPath);
            if (
              await dependencies.isObjectPathReferenced(transaction, objectPath)
            ) {
              return "raceSkipped";
            }
            await dependencies.deleteObject(objectPath);
            return "deleted";
          });
        },
        onEvent: (event) => logEvent(dependencies.logger, event),
      },
      { dryRun, minimumAgeHours: options.minimumAgeHours },
    );
    const summary = mergePendingDeletionSummary(
      reconciliationSummary,
      pendingSummary,
    );
    dependencies.logger.info(
      { event: "summary", ...summary },
      "Delivery upload cleanup finished",
    );
    return summary;
  };

  if (dryRun) return execute(dependencies.db);
  const summary = await dependencies.runWithGlobalCleanupLock(execute);
  if (summary === null) {
    dependencies.logger.info(
      { event: "concurrentRunSkipped" },
      "Delivery upload cleanup skipped because another instance is running",
    );
  }
  return summary;
}

export async function runLiveDeliveryUploadCleanup(
  dependencies: LiveDeliveryUploadCleanupDependencies,
  options: { minimumAgeHours?: number } = {},
): Promise<DeliveryUploadCleanupSummary | null> {
  return runDeliveryUploadCleanup(dependencies, { ...options, dryRun: false });
}

export interface DeliveryUploadSchedulerDependencies {
  runCleanup: () => Promise<unknown>;
  logger: CleanupLogger;
  setTimeout: (callback: () => void, delayMs: number) => { unref: () => void };
  clearTimeout: (timer: { unref: () => void }) => void;
}

export interface DeliveryUploadScheduler {
  stop: () => void;
}

export interface DeliveryUploadCleanupCoordinator {
  runIfDue: () => Promise<void>;
}

/**
 * Shares one due cleanup among timer and request callers. Failures are logged
 * and retried later so a storage URL request is never held hostage by cleanup.
 */
export function createDeliveryUploadCleanupCoordinator(
  config: DeliveryUploadCleanupConfig,
  dependencies: Pick<DeliveryUploadSchedulerDependencies, "runCleanup" | "logger">,
  now: () => number = Date.now,
): DeliveryUploadCleanupCoordinator {
  let nextDueAt = now();
  let inFlight: Promise<void> | undefined;
  const retryDelayMs = Math.min(60_000, config.intervalHours * 60 * 60 * 1000);
  return {
    runIfDue: () => {
      if (inFlight) return inFlight;
      if (now() < nextDueAt) return Promise.resolve();
      inFlight = Promise.resolve()
        .then(() => dependencies.runCleanup())
        .then(() => {
          nextDueAt = now() + config.intervalHours * 60 * 60 * 1000;
        })
        .catch((error) => {
          nextDueAt = now() + retryDelayMs;
          dependencies.logger.error(
            { err: error, retryDelayMs },
            "Delivery upload cleanup failed; upload requests will continue",
          );
        })
        .finally(() => {
          inFlight = undefined;
        });
      return inFlight;
    },
  };
}

/** Uses recursive timeouts so a slow run cannot overlap its successor. */
export function startDeliveryUploadCleanupScheduler(
  config: DeliveryUploadCleanupConfig,
  dependencies: DeliveryUploadSchedulerDependencies,
): DeliveryUploadScheduler {
  let stopped = false;
  let running = false;
  let timer: { unref: () => void } | undefined;
  const schedule = (delayMs: number) => {
    timer = dependencies.setTimeout(() => {
      void execute();
    }, delayMs);
    timer.unref();
  };
  const execute = async () => {
    if (stopped) return;
    if (running) {
      dependencies.logger.info(
        { event: "concurrentRunSkipped" },
        "Delivery upload cleanup skipped because this instance is already running",
      );
      schedule(config.intervalHours * 60 * 60 * 1000);
      return;
    }
    running = true;
    try {
      await dependencies.runCleanup();
    } catch (error) {
      dependencies.logger.error({ err: error }, "Delivery upload cleanup failed");
    } finally {
      running = false;
      if (!stopped) schedule(config.intervalHours * 60 * 60 * 1000);
    }
  };
  schedule(config.initialDelaySeconds * 1000);
  return {
    stop: () => {
      stopped = true;
      if (timer) dependencies.clearTimeout(timer);
    },
  };
}

export function createProductionDeliveryUploadCleanupDependencies(
  db: TransactionDatabase,
  deliveriesTable: any,
  deliveryPhotosTable: any,
  objectStorage: {
    listPrivateUploadObjects: () => Promise<DeliveryUploadObject[]>;
    deleteObjectEntity: (objectPath: string) => Promise<boolean>;
  },
  logger: CleanupLogger,
): LiveDeliveryUploadCleanupDependencies {
  const pool = db.$client;
  if (!pool) {
    throw new Error("Delivery upload cleanup requires a PostgreSQL pool");
  }
  return {
    db,
    runWithGlobalCleanupLock: async (callback) => {
      const client = await pool.connect();
      let acquired = false;
      try {
        acquired = await tryAcquireDeliveryUploadCleanupSessionLock(client);
        if (!acquired) return null;
        return await callback(drizzle(client as never));
      } finally {
        if (acquired) {
          try {
            await releaseDeliveryUploadCleanupSessionLock(client);
          } catch (error) {
            client.release(
              error instanceof Error
                ? error
                : new Error("Failed to release delivery cleanup session lock"),
            );
            throw error;
          }
        }
        client.release();
      }
    },
    listUploads: () => objectStorage.listPrivateUploadObjects(),
    listReferencedObjectPaths: async (database) => {
      const rows = await database
        .select({ objectPath: deliveryPhotosTable.objectPath })
        .from(deliveryPhotosTable);
      return rows.map(({ objectPath }: { objectPath: string }) => objectPath);
    },
    isObjectPathReferenced: async (transaction, objectPath) => {
      const [row] = await transaction
        .select({ objectPath: deliveryPhotosTable.objectPath })
        .from(deliveryPhotosTable)
        .where(eq(deliveryPhotosTable.objectPath, objectPath))
        .limit(1);
      return row !== undefined;
    },
    deleteObject: (objectPath) => objectStorage.deleteObjectEntity(objectPath),
    resumePendingDeletions: async (database) => {
      const summary: PendingDeletionResumeSummary = {
        candidates: 0,
        deleted: 0,
        resumedPhotoDeletions: 0,
        resumedDeliveryDeletions: 0,
        raceSkipped: 0,
        failed: 0,
        failures: [],
      };
      const pendingDeliveries = (await database.transaction((transaction: any) =>
        transaction
          .select({ id: deliveriesTable.id })
          .from(deliveriesTable)
          .where(isNotNull(deliveriesTable.deletionPendingAt))
          .orderBy(deliveriesTable.id),
      )) as Array<{ id: string }>;
      for (const pendingDelivery of pendingDeliveries) {
        summary.candidates += 1;
        let failurePath = `delivery:${pendingDelivery.id}`;
        try {
          const finalized = await database.transaction(async (transaction: any) => {
            const [delivery] = await transaction
              .select({ id: deliveriesTable.id })
              .from(deliveriesTable)
              .where(
                and(
                  eq(deliveriesTable.id, pendingDelivery.id),
                  isNotNull(deliveriesTable.deletionPendingAt),
                ),
              )
              .for("update")
              .limit(1);
            if (!delivery) return false;
            const photos = await transaction
              .select({
                id: deliveryPhotosTable.id,
                objectPath: deliveryPhotosTable.objectPath,
              })
              .from(deliveryPhotosTable)
              .where(eq(deliveryPhotosTable.deliveryId, delivery.id))
              .orderBy(deliveryPhotosTable.objectPath);
            for (const photo of photos) {
              failurePath = photo.objectPath;
              await acquireDeliveryUploadLock(transaction, photo.objectPath);
              await objectStorage.deleteObjectEntity(photo.objectPath);
            }
            await transaction
              .delete(deliveriesTable)
              .where(
                and(
                  eq(deliveriesTable.id, delivery.id),
                  isNotNull(deliveriesTable.deletionPendingAt),
                ),
              );
            return true;
          });
          if (finalized) {
            summary.deleted += 1;
            summary.resumedDeliveryDeletions += 1;
          } else summary.raceSkipped += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          summary.failed += 1;
          summary.failures.push({ objectPath: failurePath, error: message });
          logger.error(
            { objectPath: failurePath, error: message },
            "Delivery upload cleanup pending delivery finalization failed",
          );
        }
      }

      const rows = (await database.transaction((transaction: any) =>
        transaction
          .select({
            id: deliveryPhotosTable.id,
            deliveryId: deliveryPhotosTable.deliveryId,
            objectPath: deliveryPhotosTable.objectPath,
          })
          .from(deliveryPhotosTable)
          .innerJoin(
            deliveriesTable,
            eq(deliveryPhotosTable.deliveryId, deliveriesTable.id),
          )
          .where(
            and(
              isNotNull(deliveryPhotosTable.deletionPendingAt),
              isNull(deliveriesTable.deletionPendingAt),
            ),
          )
          .orderBy(deliveryPhotosTable.objectPath),
      )) as Array<{ id: string; deliveryId: string; objectPath: string }>;
      for (const row of rows) {
        summary.candidates += 1;
        try {
          const finalized = await database.transaction(async (transaction: any) => {
            const [delivery] = await transaction
              .select({
                id: deliveriesTable.id,
                deletionPendingAt: deliveriesTable.deletionPendingAt,
              })
              .from(deliveriesTable)
              .where(eq(deliveriesTable.id, row.deliveryId))
              .for("update")
              .limit(1);
            if (!delivery || delivery.deletionPendingAt !== null) return false;
            await acquireDeliveryUploadLock(transaction, row.objectPath);
            const [pending] = await transaction
              .select({
                id: deliveryPhotosTable.id,
                objectPath: deliveryPhotosTable.objectPath,
              })
              .from(deliveryPhotosTable)
              .where(
                and(
                  eq(deliveryPhotosTable.id, row.id),
                  isNotNull(deliveryPhotosTable.deletionPendingAt),
                ),
              )
              .for("update")
              .limit(1);
            if (!pending) return false;
            await objectStorage.deleteObjectEntity(pending.objectPath);
            await transaction
              .delete(deliveryPhotosTable)
              .where(
                and(
                  eq(deliveryPhotosTable.id, pending.id),
                  isNotNull(deliveryPhotosTable.deletionPendingAt),
                ),
              );
            return true;
          });
          if (finalized) {
            summary.deleted += 1;
            summary.resumedPhotoDeletions += 1;
          } else summary.raceSkipped += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          summary.failed += 1;
          summary.failures.push({ objectPath: row.objectPath, error: message });
          logger.error(
            { objectPath: row.objectPath, error: message },
            "Delivery upload cleanup pending photo finalization failed",
          );
        }
      }
      return summary;
    },
    logger,
  };
}