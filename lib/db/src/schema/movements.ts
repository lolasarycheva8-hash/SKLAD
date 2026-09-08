import { index, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { productsTable } from "./products";
import { shipmentsTable } from "./shipments";
import { goodsReceiptsTable } from "./goods-receipts";

export const movementTypeEnum = pgEnum("movement_type", ["in", "out"]);

export const movementsTable = pgTable(
  "movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "cascade" }),
    type: movementTypeEnum("type").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
    reason: text("reason"),
    note: text("note"),
    shipmentId: uuid("shipment_id").references(() => shipmentsTable.id, { onDelete: "cascade" }),
    goodsReceiptId: uuid("goods_receipt_id").references(() => goodsReceiptsTable.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("movements_product_id_idx").on(table.productId),
    index("movements_type_idx").on(table.type),
    index("movements_created_at_idx").on(table.createdAt),
    index("movements_shipment_id_idx").on(table.shipmentId),
    index("movements_goods_receipt_id_idx").on(table.goodsReceiptId),
  ],
);

export const insertMovementSchema = createInsertSchema(movementsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMovement = z.infer<typeof insertMovementSchema>;
export type Movement = typeof movementsTable.$inferSelect;
