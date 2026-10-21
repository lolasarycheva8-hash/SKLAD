import { boolean, index, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { sitesTable } from "./sites";
import { deliveriesTable } from "./deliveries";

export const ordersTable = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "restrict" }),
    siteId: uuid("site_id").references(() => sitesTable.id, {
      onDelete: "set null",
    }),
    siteName: text("site_name"),
    siteAddress: text("site_address"),
    isPaid: boolean("is_paid").notNull().default(false),
    note: text("note"),
    plannedMonth: text("planned_month"),
    fulfillmentDeliveryId: uuid("fulfillment_delivery_id").references(
      (): AnyPgColumn => deliveriesTable.id, { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("orders_client_id_idx").on(table.clientId),
    index("orders_site_id_idx").on(table.siteId),
    index("orders_is_paid_idx").on(table.isPaid),
    index("orders_created_at_idx").on(table.createdAt),
  ],
);

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
