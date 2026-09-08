import { sql, type SQL } from "drizzle-orm";

// Keep both values stable: changing either would create a second lock space and
// reintroduce attach/cleanup races across mixed application versions.
export const DELIVERY_UPLOAD_LOCK_NAMESPACE = "delivery-act-upload";
export const DELIVERY_UPLOAD_LOCK_SEED = 19_042_026;
export const DELIVERY_UPLOAD_CLEANUP_LOCK_NAME = "delivery-upload-cleanup";
export const DELIVERY_UPLOAD_CLEANUP_STATUS_LOCK_NAME =
  "delivery-upload-cleanup-status";

interface SqlExecutor {
  execute: (query: SQL) => Promise<unknown>;
}

interface QueryExecutor {
  query: (
    text: string,
    values: readonly unknown[],
  ) => Promise<{ rows: Array<{ acquired?: boolean; released?: boolean }> }>;
}

/**
 * Acquires a transaction-scoped, path-level PostgreSQL advisory lock.
 * PostgreSQL performs the hash so every caller uses the exact same key.
 */
export async function acquireDeliveryUploadLock(
  transaction: SqlExecutor,
  objectPath: string,
): Promise<void> {
  await transaction.execute(sql`
    select pg_advisory_xact_lock(
      hashtextextended(
        ${`${DELIVERY_UPLOAD_LOCK_NAMESPACE}:${objectPath}`},
        ${DELIVERY_UPLOAD_LOCK_SEED}
      )
    )
  `);
}

/** Returns immediately rather than consuming a pool connection waiting for a run. */
export async function tryAcquireDeliveryUploadCleanupLock(
  transaction: SqlExecutor,
): Promise<boolean> {
  const result = await transaction.execute(sql`
    select pg_try_advisory_xact_lock(
      hashtextextended(
        ${`${DELIVERY_UPLOAD_LOCK_NAMESPACE}:${DELIVERY_UPLOAD_CLEANUP_LOCK_NAME}`},
        ${DELIVERY_UPLOAD_LOCK_SEED}
      )
    ) as acquired
  `) as { rows?: Array<{ acquired?: boolean }> };
  return result.rows?.[0]?.acquired === true;
}

/**
 * Session-scoped variant for cleanup runs that commit each object separately.
 * The caller must always release the lock before returning the pooled client.
 */
export async function tryAcquireDeliveryUploadCleanupSessionLock(
  client: QueryExecutor,
): Promise<boolean> {
  const result = await client.query(
    `select pg_try_advisory_lock(
       hashtextextended($1, $2)
     ) as acquired`,
    [
      `${DELIVERY_UPLOAD_LOCK_NAMESPACE}:${DELIVERY_UPLOAD_CLEANUP_LOCK_NAME}`,
      DELIVERY_UPLOAD_LOCK_SEED,
    ],
  );
  return result.rows[0]?.acquired === true;
}

export async function releaseDeliveryUploadCleanupSessionLock(
  client: QueryExecutor,
): Promise<void> {
  const result = await client.query(
    `select pg_advisory_unlock(
       hashtextextended($1, $2)
     ) as released`,
    [
      `${DELIVERY_UPLOAD_LOCK_NAMESPACE}:${DELIVERY_UPLOAD_CLEANUP_LOCK_NAME}`,
      DELIVERY_UPLOAD_LOCK_SEED,
    ],
  );
  if (result.rows[0]?.released !== true) {
    throw new Error("Delivery upload cleanup session lock was not held");
  }
}

/** Serializes cleanup-status persistence with release-smoke fixtures. */
export async function acquireDeliveryUploadCleanupStatusLock(
  transaction: SqlExecutor,
): Promise<void> {
  await transaction.execute(sql`
    select pg_advisory_xact_lock(
      hashtextextended(
        ${`${DELIVERY_UPLOAD_LOCK_NAMESPACE}:${DELIVERY_UPLOAD_CLEANUP_STATUS_LOCK_NAME}`},
        ${DELIVERY_UPLOAD_LOCK_SEED}
      )
    )
  `);
}
