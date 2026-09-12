import {
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { appUsersTable } from "./app-users";
import { clientsTable } from "./clients";

export const sitesTable = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    address: text("address").notNull(),
    branch: text("branch").notNull(),
    customer: text("customer").notNull().default(""),
    client: text("client").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clientsTable.id, {
        onDelete: "restrict",
      }),
    manager: text("manager").notNull(),
    managerContact: text("manager_contact").notNull().default(""),
    director: text("director").notNull(),
    project: text("project").notNull(),
    // Preserve populated production columns as a read-only legacy archive.
    // They cannot be renamed to driver_user_id/manager_contact because their
    // types and meanings differ.
    legacyDriver: text("driver").notNull().default(""),
    legacyStoreArea: numeric("store_area").notNull().default("0"),
    driverUserId: uuid("driver_user_id").references(() => appUsersTable.id, {
      onDelete: "set null",
    }),
    deliveryType: text("delivery_type").notNull().default(""),
    features: text("features").notNull().default(""),
    closedFrom: date("closed_from", { mode: "string" }),
    reopenDate: date("reopen_date", { mode: "string" }),
    closureReason: text("closure_reason"),
    closedBy: text("closed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "sites_client_identity_fk",
      columns: [table.clientId, table.client],
      foreignColumns: [clientsTable.id, clientsTable.name],
    })
      .onUpdate("cascade")
      .onDelete("restrict"),
    index("sites_client_idx").on(table.client),
    index("sites_client_id_idx").on(table.clientId),
    index("sites_driver_user_id_idx").on(table.driverUserId),
  ],
);

export const insertSiteSchema = createInsertSchema(sitesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSite = z.infer<typeof insertSiteSchema>;
export type Site = typeof sitesTable.$inferSelect;
