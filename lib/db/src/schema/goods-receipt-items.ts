import { index, numeric, pgTable, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { goodsReceiptsTable } from "./goods-receipts";
import { productsTable } from "./products";

export const goodsReceiptItemsTable = pgTable(
  "goods_receipt_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => goodsReceiptsTable.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  },
  (table) => [
    index("goods_receipt_items_receipt_id_idx").on(table.receiptId),
    index("goods_receipt_items_product_id_idx").on(table.productId),
  ],
);

export const insertGoodsReceiptItemSchema = createInsertSchema(goodsReceiptItemsTable).omit({
  id: true,
});
export type InsertGoodsReceiptItem = z.infer<typeof insertGoodsReceiptItemSchema>;
export type GoodsReceiptItem = typeof goodsReceiptItemsTable.$inferSelect;
