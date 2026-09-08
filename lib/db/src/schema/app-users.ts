import { boolean, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "driver",
  "logistician",
  "manager",
  // Legacy database values remain accepted so Publish only adds enum values
  // and existing production rows can be normalized by the application.
  "editor",
  "viewer",
]);

export const SECTIONS = [
  "products",
  "receipts",
  "sites",
  "deliveries",
  "clients",
  "orders",
  "shipments",
  "inventory",
] as const;
export type Section = (typeof SECTIONS)[number];

export const appUsersTable = pgTable(
  "app_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    email: text("email").notNull(),
    name: text("name"),
    phone: text("phone"),
    // Keep the legacy DB default until every production database has received
    // the new enum values in an earlier committed transaction. The server
    // normalizes viewer to manager and writes canonical roles explicitly.
    role: userRoleEnum("role").notNull().default("viewer"),
    editableSections: text("editable_sections")
      .array()
      .notNull()
      .default([]),
    // Retained as an unused compatibility archive so Publish never has to
    // guess whether the legacy text column should become boolean is_driver.
    legacyDriver: text("driver"),
    isDriver: boolean("is_driver").notNull().default(false),
    assignedSiteIds: uuid("assigned_site_ids").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("app_users_clerk_user_id_idx").on(table.clerkUserId)],
);

// Pending invitations: only invited emails may sign in (besides the first
// user, who becomes admin). Role/sections are applied on first sign-in.
export const userInvitesTable = pgTable(
  "user_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    role: userRoleEnum("role").notNull().default("viewer"),
    editableSections: text("editable_sections").array().notNull().default([]),
    legacyDriver: text("driver"),
    isDriver: boolean("is_driver").notNull().default(false),
    invitedBy: text("invited_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (table) => [index("user_invites_email_idx").on(table.email)],
);

export type UserInvite = typeof userInvitesTable.$inferSelect;

export const insertAppUserSchema = createInsertSchema(appUsersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAppUser = z.infer<typeof insertAppUserSchema>;
export type AppUser = typeof appUsersTable.$inferSelect;
