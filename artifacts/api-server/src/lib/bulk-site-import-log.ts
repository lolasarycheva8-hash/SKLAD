export const BULK_SITE_IMPORT_LOG_FIELD_NAMES = [
  "rowCount",
  "writeBatchCount",
  "validationDurationMs",
  "writeDurationMs",
  "totalDurationMs",
  "succeeded",
] as const;

export type BulkSiteImportLogFields = Record<
  (typeof BULK_SITE_IMPORT_LOG_FIELD_NAMES)[number],
  number
>;

export const BULK_SITE_IMPORT_SLOW_WARNING_FIELD_NAMES = [
  "phase",
  "rowCount",
  "durationMs",
  "thresholdMs",
  "minimumRowsPerSecond",
] as const;

export type BulkSiteImportPhase = "validation" | "write";

export type BulkSiteImportSlowWarningFields = {
  phase: BulkSiteImportPhase;
  rowCount: number;
  durationMs: number;
  thresholdMs: number;
  minimumRowsPerSecond: number;
};

export const BULK_SITE_IMPORT_REPEATED_SLOW_SIGNAL_FIELD_NAMES = [
  "phase",
  "occurrenceCount",
  "windowMs",
  "maximumRowCount",
  "maximumDurationMs",
  "maximumThresholdMs",
] as const;

export type BulkSiteImportRepeatedSlowSignalFields = {
  phase: BulkSiteImportPhase;
  occurrenceCount: number;
  windowMs: number;
  maximumRowCount: number;
  maximumDurationMs: number;
  maximumThresholdMs: number;
};

export const BULK_SITE_IMPORT_SLOW_AGGREGATION_WINDOW_MS = 15 * 60 * 1_000;
export const BULK_SITE_IMPORT_SLOW_SIGNAL_OCCURRENCE_COUNT = 3;

const BULK_SITE_IMPORT_PHASE_THRESHOLDS: Record<
  BulkSiteImportPhase,
  { baseDurationMs: number; minimumRowsPerSecond: number }
> = {
  validation: {
    baseDurationMs: 1_000,
    minimumRowsPerSecond: 200,
  },
  write: {
    baseDurationMs: 2_000,
    minimumRowsPerSecond: 50,
  },
};

export function getBulkSiteImportSlowThresholdMs(
  phase: BulkSiteImportPhase,
  rowCount: number,
): number {
  const threshold = BULK_SITE_IMPORT_PHASE_THRESHOLDS[phase];
  const safeRowCount = Math.max(0, rowCount);
  return (
    threshold.baseDurationMs +
    (safeRowCount / threshold.minimumRowsPerSecond) * 1_000
  );
}

export function createBulkSiteImportSlowWarning(
  phase: BulkSiteImportPhase,
  rowCount: number,
  durationMs: number,
): BulkSiteImportSlowWarningFields | null {
  if (rowCount <= 0) return null;

  const threshold = BULK_SITE_IMPORT_PHASE_THRESHOLDS[phase];
  const thresholdMs = getBulkSiteImportSlowThresholdMs(phase, rowCount);
  if (durationMs <= thresholdMs) return null;

  return {
    phase,
    rowCount,
    durationMs,
    thresholdMs,
    minimumRowsPerSecond: threshold.minimumRowsPerSecond,
  };
}