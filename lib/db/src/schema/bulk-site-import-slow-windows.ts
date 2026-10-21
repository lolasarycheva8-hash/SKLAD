import { check, doublePrecision, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Only aggregate metrics are persisted; never retain imported rows or identities.
export const bulkSiteImportSlowWindowsTable = pgTable(
  "bulk_site_import_slow_windows",
  {
    phase: text("phase").primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    occurrenceCount: integer("occurrence_count").notNull(),
    maximumRowCount: integer("maximum_row_count").notNull(),
    maximumDurationMs: doublePrecision("maximum_duration_ms").notNull(),
    maximumThresholdMs: doublePrecision("maximum_threshold_ms").notNull(),
  },
  (table) => [
    check("bulk_site_import_slow_windows_phase_check", sql`${table.phase} IN ('validation', 'write')`),
  ],
);