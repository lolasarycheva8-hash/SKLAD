import type { DeliveryUploadCleanupSummary } from "./delivery-upload-cleanup";

export interface AutomaticCleanupStatusSummary {
  scanned: number;
  candidates: number;
  deleted: number;
  resumedPhotoDeletions: number;
  resumedDeliveryDeletions: number;
  failed: number;
}

export interface AutomaticCleanupStatusWrite {
  lastRunAt: Date;
  lastSuccessfulRunAt?: Date;
  status: "success" | "failed";
  summary: AutomaticCleanupStatusSummary;
}

export interface AutomaticCleanupStatusRow {
  key: "automatic";
  lastRunAt: Date;
  lastSuccessfulRunAt: Date | null;
  status: "success" | "failed";
  scanned: number;
  candidates: number;
  deleted: number;
  resumedPhotoDeletions: number;
  resumedDeliveryDeletions: number;
  failed: number;
  updatedAt: Date;
}

export interface AutomaticCleanupStatusUpsert {
  insert: AutomaticCleanupStatusRow;
  update: Omit<
    AutomaticCleanupStatusRow,
    "key" | "lastSuccessfulRunAt"
  > & {
    lastSuccessfulRunAt?: Date;
  };
}

interface AutomaticCleanupRunRecorderDependencies {
  runCleanup: () => Promise<DeliveryUploadCleanupSummary | null>;
  writeStatus: (status: AutomaticCleanupStatusWrite) => Promise<void>;
  now?: () => Date;
}

export class AutomaticCleanupStatusRecordingError extends Error {
  readonly statusWriteError: unknown;

  constructor(cleanupError: unknown, statusWriteError: unknown) {
    super("Cleanup failed and its failed status could not be recorded", {
      cause: cleanupError,
    });
    this.name = "AutomaticCleanupStatusRecordingError";
    this.statusWriteError = statusWriteError;
  }
}

export function createAutomaticCleanupStatusWriter(
  persistUpsert: (upsert: AutomaticCleanupStatusUpsert) => Promise<void>,
): (status: AutomaticCleanupStatusWrite) => Promise<void> {
  return async (status) => {
    const aggregateFields = {
      status: status.status,
      scanned: status.summary.scanned,
      candidates: status.summary.candidates,
      deleted: status.summary.deleted,
      resumedPhotoDeletions: status.summary.resumedPhotoDeletions,
      resumedDeliveryDeletions: status.summary.resumedDeliveryDeletions,
      failed: status.summary.failed,
    };
    await persistUpsert({
      insert: {
        key: "automatic",
        lastRunAt: status.lastRunAt,
        lastSuccessfulRunAt: status.lastSuccessfulRunAt ?? null,
        ...aggregateFields,
        updatedAt: status.lastRunAt,
      },
      update: {
        lastRunAt: status.lastRunAt,
        ...(status.lastSuccessfulRunAt
          ? { lastSuccessfulRunAt: status.lastSuccessfulRunAt }
          : {}),
        ...aggregateFields,
        updatedAt: status.lastRunAt,
      },
    });
  };
}

function statusSummary(
  summary: DeliveryUploadCleanupSummary,
): AutomaticCleanupStatusSummary {
  return {
    scanned: summary.scanned,
    candidates: summary.candidates,
    deleted: summary.deleted,
    resumedPhotoDeletions: summary.resumedPhotoDeletions,
    resumedDeliveryDeletions: summary.resumedDeliveryDeletions,
    failed: summary.failed,
  };
}

/**
 * Records only aggregate counters. An omitted lastSuccessfulRunAt tells the
 * persistence layer to retain the previous successful-run timestamp.
 */
export function createAutomaticCleanupRunRecorder(
  dependencies: AutomaticCleanupRunRecorderDependencies,
): () => Promise<void> {
  return async () => {
    const runAt = (dependencies.now ?? (() => new Date()))();
    try {
      const summary = await dependencies.runCleanup();
      if (summary === null) return;

      const succeeded = summary.failed === 0;
      await dependencies.writeStatus({
        lastRunAt: runAt,
        ...(succeeded ? { lastSuccessfulRunAt: runAt } : {}),
        status: succeeded ? "success" : "failed",
        summary: statusSummary(summary),
      });
    } catch (cleanupError) {
      try {
        await dependencies.writeStatus({
          lastRunAt: runAt,
          status: "failed",
          summary: {
            scanned: 0,
            candidates: 0,
            deleted: 0,
            resumedPhotoDeletions: 0,
            resumedDeliveryDeletions: 0,
            failed: 1,
          },
        });
      } catch (statusWriteError) {
        throw new AutomaticCleanupStatusRecordingError(
          cleanupError,
          statusWriteError,
        );
      }
      throw cleanupError;
    }
  };
}