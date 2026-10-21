import { pgTable, uuid, text, timestamp, numeric, serial, uniqueIndex, index } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { ordersTable } from "./orders";

export const orderSummariesTable = pgTable("order_summaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: serial("number").notNull().unique(),
  requestId: uuid("request_id").notNull().unique(),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "restrict" }),
  clientName: text("client_name").notNull(),
  periodFrom: text("period_from").notNull(),
  periodTo: text("period_to").notNull(),
  totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, (table) => [index("order_summaries_client_idx").on(table.clientId)]);

export const orderSummaryMembersTable = pgTable("order_summary_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  summaryId: uuid("summary_id").notNull().references(() => orderSummariesTable.id, { onDelete: "restrict" }),
  orderId: uuid("order_id").notNull().references(() => ordersTable.id, { onDelete: "restrict" }),
  orderNumber: text("order_number").notNull(),
}, (table) => [
  uniqueIndex("order_summary_members_order_uq").on(table.orderId),
  index("order_summary_members_summary_idx").on(table.summaryId),
]);

export const orderSummaryItemsTable = pgTable("order_summary_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  summaryId: uuid("summary_id").notNull().references(() => orderSummariesTable.id, { onDelete: "restrict" }),
  // Catalogue identities/names are immutable snapshots, not cascade targets.
  productId: uuid("product_id").notNull(),
  productName: text("product_name").notNull(),
  unit: text("unit").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 2 }).notNull(),
  price: numeric("price", { precision: 18, scale: 2 }).notNull(),
  total: numeric("total", { precision: 18, scale: 2 }).notNull(),
}, (table) => [index("order_summary_items_summary_idx").on(table.summaryId)]);