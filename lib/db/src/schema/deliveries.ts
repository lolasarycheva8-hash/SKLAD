import { date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sitesTable } from "./sites";
import { appUsersTable } from "./app-users";

export const deliveriesTable = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sitesTable.id, { onDelete: "cascade" }),
    // Preserve the old free-text assignment during the transition to users.
    legacyDriver: text("driver").notNull().default(""),
    driverUserId: uuid("driver_user_id").references(() => appUsersTable.id, {
      onDelete: "set null",
    }),
    plannedDate: date("planned_date", { mode: "string" }),
    correctedPlannedDate: date("corrected_planned_date", { mode: "string" }),
    deliveryType: text("delivery_type"),
    scheduleMonth: text("schedule_month"),
    actualDate: date("actual_date", { mode: "string" }),
    actApprovedAt: timestamp("act_approved_at", { withTimezone: true }),
    actApprovedBy: uuid("act_approved_by").references(() => appUsersTable.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    logisticianNote: text("logistician_note"),
    rescheduledFromDate: date("rescheduled_from_date", { mode: "string" }),
    rescheduledBy: text("rescheduled_by"),
    rescheduledAt: timestamp("rescheduled_at", { withTimezone: true }),
    deletionPendingAt: timestamp("deletion_pending_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("deliveries_owned_dated_uq")
      .on(table.siteId, table.scheduleMonth, table.plannedDate)
      .where(
        sql`${table.scheduleMonth} is not null and ${table.plannedDate} is not null`,
      ),
    uniqueIndex("deliveries_owned_undated_uq")
      .on(table.siteId, table.scheduleMonth)
      .where(
        sql`${table.scheduleMonth} is not null and ${table.plannedDate} is null`,
      ),
  ],
);

export const insertDeliverySchema = createInsertSchema(deliveriesTable).omit({
  id: true,
  createdAt: true,
  actualDate: true,
  actApprovedAt: true,
  actApprovedBy: true,
  deletionPendingAt: true,
});
export type InsertDelivery = z.infer<typeof insertDeliverySchema>;
export type Delivery = typeof deliveriesTable.$inferSelect;
