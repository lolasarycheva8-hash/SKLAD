import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Справочник типов поставки: поле "Тип поставки" у объекта может принимать
// значения строго из этого справочника (пустое значение допускается).
export const deliveryTypesTable = pgTable("delivery_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDeliveryTypeSchema = createInsertSchema(deliveryTypesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDeliveryType = z.infer<typeof insertDeliveryTypeSchema>;
export type DeliveryTypeRow = typeof deliveryTypesTable.$inferSelect;
