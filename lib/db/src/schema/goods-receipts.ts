import { boolean, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const goodsReceiptsTable = pgTable(
  "goods_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docNumber: text("doc_number").notNull(),
    docType: text("doc_type").notNull(),
    totalSum: numeric("total_sum", { precision: 14, scale: 2 }).notNull(),
    note: text("note"),
    isPosted: boolean("is_posted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("goods_receipts_created_at_idx").on(table.createdAt)],
);

export const insertGoodsReceiptSchema = createInsertSchema(goodsReceiptsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertGoodsReceipt = z.infer<typeof insertGoodsReceiptSchema>;
export type GoodsReceipt = typeof goodsReceiptsTable.$inferSelect;
