import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { appUsersTable } from "./app-users";
import { sitesTable } from "./sites";

export const siteChangeRequestStatusEnum = pgEnum(
  "site_change_request_status",
  ["pending", "approved", "rejected"],
);

export type SiteChangeRequestPayload = Partial<{
  name: string;
  address: string;
  branch: string;
  customer: string;
  clientId: string;
  manager: string;
  managerContact: string;
  director: string;
  project: string;
  driverUserId: string | null;
  deliveryType: string;
}>;

export const siteChangeRequestsTable = pgTable(
  "site_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").references(() => sitesTable.id, {
      onDelete: "set null",
    }),
    siteName: text("site_name").notNull(),
    authorUserId: uuid("author_user_id").references(
      () => appUsersTable.id,
      { onDelete: "set null" },
    ),
    authorName: text("author_name").notNull(),
    authorEmail: text("author_email").notNull(),
    payload: jsonb("payload").$type<SiteChangeRequestPayload>().notNull(),
    originalPayload: jsonb("original_payload")
      .$type<SiteChangeRequestPayload>()
      .notNull(),
    status: siteChangeRequestStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByUserId: uuid("decided_by_user_id").references(
      () => appUsersTable.id,
      { onDelete: "set null" },
    ),
    decidedByName: text("decided_by_name"),
    decidedByEmail: text("decided_by_email"),
  },
  (table) => [
    index("site_change_requests_site_idx").on(table.siteId),
    index("site_change_requests_status_idx").on(table.status),
    uniqueIndex("site_change_requests_pending_author_site_uidx")
      .on(table.siteId, table.authorUserId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const insertSiteChangeRequestSchema = createInsertSchema(
  siteChangeRequestsTable,
).omit({
  id: true,
  createdAt: true,
});
export type InsertSiteChangeRequest = z.infer<
  typeof insertSiteChangeRequestSchema
>;
export type SiteChangeRequest = typeof siteChangeRequestsTable.$inferSelect;