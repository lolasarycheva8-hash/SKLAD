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
    reviewedByNameSnapshot: text("reviewed_by_name_snapshot"),
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

export const BACKFILL_LEGACY_REVIEW_AUTHOR_NAMES_SQL = `
  UPDATE legacy_driver_similarity_reviews AS review
  SET reviewed_by_name_snapshot = app_user.name
  FROM app_users AS app_user
  WHERE review.reviewed_by = app_user.id
    AND review.reviewed_by_name_snapshot IS NULL
    AND app_user.name IS NOT NULL
`;
