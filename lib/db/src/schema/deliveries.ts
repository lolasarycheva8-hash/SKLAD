import {
  date,
  foreignKey,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sitesTable } from "./sites";
import { appUsersTable } from "./app-users";
import { ordersTable } from "./orders";

export const deliveriesTable = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sitesTable.id, { onDelete: "restrict" }),
    parentDeliveryId: uuid("parent_delivery_id"),
    orderId: uuid("order_id").references((): AnyPgColumn => ordersTable.id, {
      onDelete: "restrict",
    }),
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
    // Reversible archive metadata is intentionally separate from the
    // irreversible storage cleanup marker above.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => appUsersTable.id, {
      onDelete: "set null",
    }),
    archivedByName: text("archived_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "deliveries_parent_delivery_id_fk",
      columns: [table.parentDeliveryId],
      foreignColumns: [table.id],
    }).onDelete("restrict"),
    uniqueIndex("deliveries_order_id_uq").on(table.orderId),
    // Schedule ownership applies to primary rows only. Supplemental
    // deliveries intentionally share the parent's site/date slot.
    uniqueIndex("deliveries_primary_dated_active_uq")
      .on(table.siteId, table.scheduleMonth, table.plannedDate)
      .where(
        sql`${table.archivedAt} is null and ${table.orderId} is null and ${table.scheduleMonth} is not null and ${table.plannedDate} is not null`,
      ),
    uniqueIndex("deliveries_primary_undated_active_uq")
      .on(table.siteId, table.scheduleMonth)
      .where(
        sql`${table.archivedAt} is null and ${table.orderId} is null and ${table.scheduleMonth} is not null and ${table.plannedDate} is null`,
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
  archivedAt: true,
  archivedBy: true,
  archivedByName: true,
});
export type InsertDelivery = z.infer<typeof insertDeliverySchema>;
export type Delivery = typeof deliveriesTable.$inferSelect;
