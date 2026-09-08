import {
  db,
  deliveriesTable,
  deliveryPhotosTable,
  deliveryUploadCleanupStatusTable,
} from "@workspace/db";

import { logger } from "./logger";
import { ObjectStorageService } from "./objectStorage";
import {
  createDeliveryUploadCleanupCoordinator,
  createProductionDeliveryUploadCleanupDependencies,
  getDeliveryUploadCleanupConfig,
  runLiveDeliveryUploadCleanup,
  type DeliveryUploadScheduler,
  type DeliveryUploadCleanupCoordinator,
  startDeliveryUploadCleanupScheduler,
} from "./delivery-upload-cleanup";
import { acquireDeliveryUploadCleanupStatusLock } from "./delivery-upload-lock";
import {
  createAutomaticCleanupRunRecorder,
  createAutomaticCleanupStatusWriter,
} from "./delivery-upload-cleanup-status";

const config = getDeliveryUploadCleanupConfig();
const objectStorage = new ObjectStorageService();
const dependencies = createProductionDeliveryUploadCleanupDependencies(
  db,
  deliveriesTable,
  deliveryPhotosTable,
  objectStorage,
  logger,
);

const writeAutomaticCleanupStatus = createAutomaticCleanupStatusWriter(
  async ({ insert, update }) => {
  await db.transaction(async (tx) => {
    await acquireDeliveryUploadCleanupStatusLock(tx);
    await tx
      .insert(deliveryUploadCleanupStatusTable)
        .values(insert)
      .onConflictDoUpdate({
        target: deliveryUploadCleanupStatusTable.key,
          set: update,
      });
  });
  },
);

const recordAutomaticCleanupRun = createAutomaticCleanupRunRecorder({
  runCleanup: () =>
    runLiveDeliveryUploadCleanup(dependencies, {
      minimumAgeHours: config.retentionHours,
    }),
  writeStatus: writeAutomaticCleanupStatus,
});

export const deliveryUploadCleanupCoordinator: DeliveryUploadCleanupCoordinator =
  createDeliveryUploadCleanupCoordinator(config, {
    runCleanup: recordAutomaticCleanupRun,
    logger,
  });

let scheduler: DeliveryUploadScheduler | undefined;

/** Starts once from the listening API process; routes only use the coordinator. */
export function startProductionDeliveryUploadCleanupScheduler(): void {
  if (scheduler) return;
  scheduler = startDeliveryUploadCleanupScheduler(config, {
    runCleanup: () => deliveryUploadCleanupCoordinator.runIfDue(),
    logger,
    setTimeout,
    clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
}