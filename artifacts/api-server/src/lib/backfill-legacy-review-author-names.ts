import { BACKFILL_LEGACY_REVIEW_AUTHOR_NAMES_SQL } from "@workspace/db";

type Queryable = {
  query: (text: string) => Promise<{ rowCount?: number | null }>;
};

export async function backfillLegacyReviewAuthorNames(
  database: Queryable,
): Promise<number> {
  const result = await database.query(BACKFILL_LEGACY_REVIEW_AUTHOR_NAMES_SQL);
  return result.rowCount ?? 0;
}
