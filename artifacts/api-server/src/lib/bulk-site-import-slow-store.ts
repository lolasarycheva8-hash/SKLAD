import { bulkSiteImportSlowWindowsTable, db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  BULK_SITE_IMPORT_SLOW_AGGREGATION_WINDOW_MS,
  BULK_SITE_IMPORT_SLOW_SIGNAL_OCCURRENCE_COUNT,
  type BulkSiteImportRepeatedSlowSignalFields,
  type BulkSiteImportSlowWarningFields,
} from "./bulk-site-import-log";

type Database = Pick<typeof db, "execute">;

export function createBulkSiteImportSlowWarningAggregator(database: Database = db) {
  return async (
    warning: BulkSiteImportSlowWarningFields,
  ): Promise<BulkSiteImportRepeatedSlowSignalFields | null> => {
    // A single upsert locks the shared phase row, including on first insertion.
    // All expiry comparisons use the same database time, not an API instance clock.
    const result = await database.execute<{
      occurrenceCount: number;
      maximumRowCount: number;
      maximumDurationMs: number;
      maximumThresholdMs: number;
    }>(sql`
      INSERT INTO ${bulkSiteImportSlowWindowsTable} AS current_window
        (phase, started_at, expires_at, occurrence_count,
         maximum_row_count, maximum_duration_ms, maximum_threshold_ms)
      VALUES (
        ${warning.phase}, statement_timestamp(),
        statement_timestamp() + ${BULK_SITE_IMPORT_SLOW_AGGREGATION_WINDOW_MS} * interval '1 millisecond',
        1, ${warning.rowCount}, ${warning.durationMs}, ${warning.thresholdMs}
      )
      ON CONFLICT (phase) DO UPDATE SET
        started_at = CASE WHEN current_window.expires_at <= EXCLUDED.started_at
          THEN EXCLUDED.started_at ELSE current_window.started_at END,
        expires_at = CASE WHEN current_window.expires_at <= EXCLUDED.started_at
          THEN EXCLUDED.expires_at ELSE current_window.expires_at END,
        occurrence_count = CASE WHEN current_window.expires_at <= EXCLUDED.started_at
          THEN 1 ELSE current_window.occurrence_count + 1 END,
        maximum_row_count = CASE WHEN current_window.expires_at <= EXCLUDED.started_at
          THEN EXCLUDED.maximum_row_count
          ELSE GREATEST(current_window.maximum_row_count, EXCLUDED.maximum_row_count) END,
        maximum_duration_ms = CASE WHEN current_window.expires_at <= EXCLUDED.started_at
          THEN EXCLUDED.maximum_duration_ms
          ELSE GREATEST(current_window.maximum_duration_ms, EXCLUDED.maximum_duration_ms) END,
        maximum_threshold_ms = CASE WHEN current_window.expires_at <= EXCLUDED.started_at
          THEN EXCLUDED.maximum_threshold_ms
          ELSE GREATEST(current_window.maximum_threshold_ms, EXCLUDED.maximum_threshold_ms) END
      RETURNING occurrence_count AS "occurrenceCount",
        maximum_row_count AS "maximumRowCount",
        maximum_duration_ms AS "maximumDurationMs",
        maximum_threshold_ms AS "maximumThresholdMs"
    `);
    const window = result.rows[0];
    // Only the writer that increments to the threshold emits the signal.
    // Persisting subsequent counts also prevents another signal after restart.
    if (window.occurrenceCount !== BULK_SITE_IMPORT_SLOW_SIGNAL_OCCURRENCE_COUNT) {
      return null;
    }
    return {
      phase: warning.phase,
      occurrenceCount: window.occurrenceCount,
      windowMs: BULK_SITE_IMPORT_SLOW_AGGREGATION_WINDOW_MS,
      maximumRowCount: window.maximumRowCount,
      maximumDurationMs: window.maximumDurationMs,
      maximumThresholdMs: window.maximumThresholdMs,
    };
  };
}

export async function cleanupExpiredBulkSiteImportSlowWindows(
  database: Database = db,
): Promise<void> {
  // PostgreSQL rechecks this predicate after a concurrent upsert releases its lock.
  await database.execute(sql`
    DELETE FROM ${bulkSiteImportSlowWindowsTable}
    WHERE expires_at <= statement_timestamp()
  `);
}

export const recordBulkSiteImportSlowWarning =
  createBulkSiteImportSlowWarningAggregator();