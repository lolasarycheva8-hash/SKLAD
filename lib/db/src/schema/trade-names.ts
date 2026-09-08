import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Справочник торговых названий объектов: поле "Торговое название объекта"
// у объекта может принимать значения строго из этого справочника.
export const tradeNamesTable = pgTable("trade_names", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTradeNameSchema = createInsertSchema(tradeNamesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTradeName = z.infer<typeof insertTradeNameSchema>;
export type TradeName = typeof tradeNamesTable.$inferSelect;
