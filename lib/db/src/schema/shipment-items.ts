import { numeric, pgTable, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { shipmentsTable } from "./shipments";
import { productsTable } from "./products";

export const shipmentItemsTable = pgTable("shipment_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  shipmentId: uuid("shipment_id")
    .notNull()
    .references(() => shipmentsTable.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => productsTable.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
});

export const insertShipmentItemSchema = createInsertSchema(shipmentItemsTable).omit({
  id: true,
});
export type InsertShipmentItem = z.infer<typeof insertShipmentItemSchema>;
export type ShipmentItem = typeof shipmentItemsTable.$inferSelect;
