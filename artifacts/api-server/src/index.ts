import { pool } from "@workspace/db";

import app from "./app";
import { backfillLegacyReviewAuthorNames } from "./lib/backfill-legacy-review-author-names";
import { logger } from "./lib/logger";
import { startProductionDeliveryUploadCleanupScheduler } from "./lib/delivery-upload-cleanup-runtime";
import { startBulkSiteImportSlowWindowCleanup } from "./lib/bulk-site-import-slow-cleanup";
import { cleanupExpiredBulkSiteImportSlowWindows } from "./lib/bulk-site-import-slow-store";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main() {
  const backfilledLegacyReviewAuthorCount =
    await backfillLegacyReviewAuthorNames(pool);
  if (backfilledLegacyReviewAuthorCount > 0) {
    logger.info(
      { count: backfilledLegacyReviewAuthorCount },
      "Backfilled legacy review author names",
    );
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startProductionDeliveryUploadCleanupScheduler();
    startBulkSiteImportSlowWindowCleanup({
      cleanup: cleanupExpiredBulkSiteImportSlowWindows,
      onError: () => logger.error("Failed to clean up bulk site import slow windows"),
    });
  });
}

void main().catch((err) => {
  logger.error({ err }, "Failed to prepare the database before startup");
  process.exit(1);
});
