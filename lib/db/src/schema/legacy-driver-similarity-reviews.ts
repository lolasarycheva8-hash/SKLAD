import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { appUsersTable } from "./app-users";

export const legacyDriverSimilarityReviewsTable = pgTable(
  "legacy_driver_similarity_reviews",
  {
    similarityGroup: text("similarity_group").primaryKey(),
    legacyNames: text("legacy_names").array().notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedBy: uuid("reviewed_by").references(() => appUsersTable.id, {
      onDelete: "set null",
    }),
  },
);

export const insertLegacyDriverSimilarityReviewSchema = createInsertSchema(
  legacyDriverSimilarityReviewsTable,
).omit({ reviewedAt: true });
export type InsertLegacyDriverSimilarityReview = z.infer<
  typeof insertLegacyDriverSimilarityReviewSchema
>;
export type LegacyDriverSimilarityReview =
  typeof legacyDriverSimilarityReviewsTable.$inferSelect;