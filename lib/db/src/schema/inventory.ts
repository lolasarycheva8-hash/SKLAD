import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sitesTable } from "./sites";

// Справочник инвентаря (хозтовары, расходники)
export const inventoryItemsTable = pgTable("inventory_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  unit: text("unit").notNull().default("шт"),
  category: text("category"),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryRequestStatusEnum = pgEnum("inventory_request_status", [
  "new",
  "approved",
  "rejected",
  "done",
]);

// Заявка на инвентарь с согласованием (создана → одобрена/отклонена → выдана)
export const inventoryRequestsTable = pgTable(
  "inventory_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").references(() => sitesTable.id, { onDelete: "set null" }),
    status: inventoryRequestStatusEnum("status").notNull().default("new"),
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdByUserId: uuid("created_by_user_id"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    doneBy: text("done_by"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("inventory_requests_status_idx").on(table.status),
    index("inventory_requests_site_idx").on(table.siteId),
  ],
);

export const inventoryRequestItemsTable = pgTable(
  "inventory_request_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => inventoryRequestsTable.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => inventoryItemsTable.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    unit: text("unit").notNull(),
    qty: numeric("qty", { precision: 12, scale: 2 }).notNull(),
  },
  (table) => [index("inventory_request_items_request_idx").on(table.requestId)],
);

export type InventoryItem = typeof inventoryItemsTable.$inferSelect;
export type InventoryRequest = typeof inventoryRequestsTable.$inferSelect;
export type InventoryRequestItem = typeof inventoryRequestItemsTable.$inferSelect;
