import { index, jsonb, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Append-only trail of every mutating API request. User email/name are
// denormalized so the record stays meaningful even if the user is later removed.
export const auditLogTable = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id"),
    userEmail: text("user_email").notNull(),
    userName: text("user_name"),
    method: text("method").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    path: text("path").notNull(),
    statusCode: integer("status_code").notNull(),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_created_at_idx").on(table.createdAt),
    index("audit_log_user_id_idx").on(table.userId),
    index("audit_log_entity_idx").on(table.entity),
  ],
);

export const insertAuditLogSchema = createInsertSchema(auditLogTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogTable.$inferSelect;
