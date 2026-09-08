import { boolean, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ordersTable } from "./orders";
import { sitesTable } from "./sites";
import { appUsersTable } from "./app-users";

export const shipmentsTable = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "restrict" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sitesTable.id, { onDelete: "restrict" }),
    // Keep the old free-text field so Publish remains additive while new
    // shipments use driver_user_id.
    legacyDriver: text("driver").notNull().default(""),
    driverUserId: uuid("driver_user_id").references(() => appUsersTable.id, {
      onDelete: "set null",
    }),
    shipmentDate: date("shipment_date", { mode: "string" }).notNull(),
    note: text("note"),
    isDispatched: boolean("is_dispatched").notNull().default(false),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deleteNote: text("delete_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("shipments_order_id_idx").on(table.orderId),
    index("shipments_site_id_idx").on(table.siteId),
    index("shipments_driver_user_id_idx").on(table.driverUserId),
    index("shipments_shipment_date_idx").on(table.shipmentDate),
    index("shipments_created_at_idx").on(table.createdAt),
  ],
);

export const insertShipmentSchema = createInsertSchema(shipmentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertShipment = z.infer<typeof insertShipmentSchema>;
export type Shipment = typeof shipmentsTable.$inferSelect;
