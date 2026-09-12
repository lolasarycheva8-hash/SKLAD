import { pool } from "@workspace/db";

import { backfillLegacyReviewAuthorNames } from "../lib/backfill-legacy-review-author-names";

async function main(): Promise<void> {
  const backfilledLegacyReviewAuthorCount =
    await backfillLegacyReviewAuthorNames(pool);
  console.log(
    JSON.stringify({
      backfilledLegacyReviewAuthorCount,
    }),
  );
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
