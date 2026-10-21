import type {
  default as pg,
  QueryConfig,
  QueryResult,
  QueryResultRow,
} from "pg";

/**
 * This pair is a process-independent, database-wide lock identity. Keep it
 * stable across releases: mixed versions must coordinate in the same space.
 */
export const BACKUP_FILE_LOCK_CLASS_ID = 1_112_225_874;
export const BACKUP_FILE_LOCK_OBJECT_ID = 1_717_628_012;
export const BACKUP_FILE_LOCK_TIMEOUT_MS = 30_000;

export interface BackupFileBarrierOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

type LockMode = "exclusive" | "shared";

function abortError(): DOMException {
  return new DOMException("Backup file lock acquisition aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      reject(abortError());
    }
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

async function queryWithTimeout<Row extends QueryResultRow>(
  client: pg.PoolClient,
  text: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ rows: Row[] }> {
  const boundedTimeoutMs = Math.max(1, Math.ceil(timeoutMs));
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () => settle(new Error("Timed out executing backup file lock query")),
      boundedTimeoutMs,
    );
    const aborted = () => settle(abortError());
    const settle = (
      error?: unknown,
      result?: { rows: Row[] },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      if (error !== undefined) reject(error);
      else resolve(result!);
    };

    signal?.addEventListener("abort", aborted, { once: true });
    // query_timeout asks node-postgres to abandon the query as well as the
    // independent timer above. The timer is still required for malformed or
    // wedged clients that never honor node-postgres' timeout.
    const config = {
      text,
      values: [BACKUP_FILE_LOCK_CLASS_ID, BACKUP_FILE_LOCK_OBJECT_ID],
      // Supported by node-postgres at runtime but absent from its current
      // public QueryConfig type.
      query_timeout: boundedTimeoutMs,
    } as QueryConfig & { query_timeout: number };
    const query = client.query(config) as Promise<QueryResult<Row>>;
    void query.then(
      (result) => settle(undefined, result),
      (error) => settle(error),
    );
    if (signal?.aborted) aborted();
  });
}

async function connectWithDeadline(
  pool: pg.Pool,
  deadline: number,
  signal?: AbortSignal,
): Promise<pg.PoolClient> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const remaining = Math.max(0, deadline - Date.now());
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Timed out acquiring a PostgreSQL client for backup file lock"));
    }, remaining);
    const aborted = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
    };

    signal?.addEventListener("abort", aborted, { once: true });
    pool.connect((error, client) => {
      if (settled) {
        // Pool acquisition cannot itself be cancelled. Return a late client
        // immediately rather than leaking it after timeout/cancellation.
        client?.release();
        return;
      }
      settled = true;
      cleanup();
      if (error || !client) {
        reject(error ?? new Error("PostgreSQL pool returned no client"));
      } else {
        resolve(client);
      }
    });
    if (signal?.aborted) aborted();
  });
}

async function acquire(
  client: pg.PoolClient,
  mode: LockMode,
  deadline: number,
  signal?: AbortSignal,
): Promise<void> {
  const functionName =
    mode === "exclusive"
      ? "pg_try_advisory_lock"
      : "pg_try_advisory_lock_shared";

  while (true) {
    throwIfAborted(signal);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Timed out acquiring ${mode} backup file lock`);
    }
    const result = await queryWithTimeout<{ acquired: boolean }>(
      client,
      `select ${functionName}($1, $2) as acquired`,
      remaining,
      signal,
    );
    if (result.rows[0]?.acquired === true) return;

    const delayRemaining = deadline - Date.now();
    if (delayRemaining <= 0) {
      throw new Error(`Timed out acquiring ${mode} backup file lock`);
    }
    await delay(Math.min(50, delayRemaining), signal);
  }
}

async function runBarrier<T>(
  pool: pg.Pool,
  mode: LockMode,
  operation: () => Promise<T>,
  options: BackupFileBarrierOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? BACKUP_FILE_LOCK_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError("Backup file lock timeout must be a non-negative number");
  }

  const deadline = Date.now() + timeoutMs;
  const client = await connectWithDeadline(pool, deadline, options.signal);
  let acquired = false;
  let discard = false;
  try {
    try {
      await acquire(client, mode, deadline, options.signal);
    } catch (error) {
      // A failed query may have reached PostgreSQL and acquired the session
      // lock before the response/connection failed. Destroying the client is
      // the only certain way to release that possibly-held lock.
      discard = true;
      throw error;
    }
    acquired = true;
    throwIfAborted(options.signal);
    return await operation();
  } finally {
    if (acquired) {
      const unlockFunction =
        mode === "exclusive"
          ? "pg_advisory_unlock"
          : "pg_advisory_unlock_shared";
      try {
        const result = await queryWithTimeout<{ released: boolean }>(
          client,
          `select ${unlockFunction}($1, $2) as released`,
          timeoutMs,
        );
        discard = result.rows[0]?.released !== true;
      } catch {
        discard = true;
      }
    }
    client.release(
      discard
        ? new Error("Backup file advisory lock release could not be confirmed")
        : undefined,
    );
  }
}

/** Holds an exclusive session lock across snapshot/read/copy work. */
export function withBackupFileReadBarrier<T>(
  pool: pg.Pool,
  operation: () => Promise<T>,
): Promise<T> {
  return runBarrier(pool, "exclusive", operation);
}

/** Holds a shared session lock while physical object bytes are deleted. */
export function withBackupFileDeletionBarrier<T>(
  pool: pg.Pool,
  operation: () => Promise<T>,
): Promise<T> {
  return runBarrier(pool, "shared", operation);
}

/**
 * Deletion-only variant used to stop waiting promptly when an HTTP/cleanup
 * request is cancelled. The public backup/deletion contract remains the two
 * argument helpers above.
 */
export function withAbortableBackupFileDeletionBarrier<T>(
  pool: pg.Pool,
  operation: () => Promise<T>,
  options: BackupFileBarrierOptions,
): Promise<T> {
  return runBarrier(pool, "shared", operation, options);
}