import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const deliveryUploadCleanupStatusTable = pgTable(
  "delivery_upload_cleanup_status",
  {
    key: text("key").primaryKey(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull(),
    lastSuccessfulRunAt: timestamp("last_successful_run_at", { withTimezone: true }),
    status: text("status").notNull(),
    scanned: integer("scanned").notNull().default(0),
    candidates: integer("candidates").notNull().default(0),
    deleted: integer("deleted").notNull().default(0),
    resumedPhotoDeletions: integer("resumed_photo_deletions")
      .notNull()
      .default(0),
    resumedDeliveryDeletions: integer("resumed_delivery_deletions")
      .notNull()
      .default(0),
    failed: integer("failed").notNull().default(0),
    failureKind: text("failure_kind").notNull().default("none"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const insertDeliveryUploadCleanupStatusSchema = createInsertSchema(
  deliveryUploadCleanupStatusTable,
).omit({ updatedAt: true });
export type InsertDeliveryUploadCleanupStatus = z.infer<
  typeof insertDeliveryUploadCleanupStatusSchema
>;
export type DeliveryUploadCleanupStatus =
  typeof deliveryUploadCleanupStatusTable.$inferSelect;