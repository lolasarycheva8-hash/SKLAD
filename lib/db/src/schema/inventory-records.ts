import { sql } from "drizzle-orm";
import { check, doublePrecision, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sitesTable } from "./sites";

export const inventoryRecordsTable = pgTable("inventory_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind", { enum: ["equipment", "consumables", "spare_parts"] }).notNull(),
  name: text("name").notNull(),
  type: text("type"),
  model: text("model"),
  inventoryNumber: text("inventory_number"),
  sku: text("sku"),
  quantity: doublePrecision("quantity").notNull(),
  unit: text("unit").notNull(),
  condition: text("condition").notNull(),
  status: text("status").notNull(),
  siteId: uuid("site_id").references(() => sitesTable.id, { onDelete: "restrict" }),
  notes: text("notes"),
}, (table) => [
  check("inventory_records_kind_check", sql`${table.kind} in ('equipment', 'consumables', 'spare_parts')`),
  check("inventory_records_quantity_check", sql`${table.quantity} >= 0 and ${table.quantity} <= 1000000000`),
  check("inventory_records_identity_check", sql`(${table.kind} = 'equipment' and nullif(btrim(${table.inventoryNumber}), '') is not null and ${table.quantity} = 1) or (${table.kind} in ('consumables', 'spare_parts') and nullif(btrim(${table.sku}), '') is not null)`),
  uniqueIndex("inventory_records_equipment_number_unique").on(sql`lower(btrim(${table.inventoryNumber}))`).where(sql`${table.kind} = 'equipment'`),
  uniqueIndex("inventory_records_kind_sku_unique").on(table.kind, sql`lower(btrim(${table.sku}))`).where(sql`${table.kind} <> 'equipment'`),
  index("inventory_records_site_idx").on(table.siteId),
]);

export const insertInventoryRecordSchema = createInsertSchema(inventoryRecordsTable).omit({ id: true });
export type InsertInventoryRecord = z.infer<typeof insertInventoryRecordSchema>;
export type InventoryRecord = typeof inventoryRecordsTable.$inferSelect;