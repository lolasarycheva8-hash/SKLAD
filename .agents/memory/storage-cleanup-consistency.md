---
name: Storage cleanup consistency
description: Consistency rules for deleting database records backed by external object storage.
---

Serialize attachment and parent deletion around the same database lock. During multi-object cleanup, remove each database reference as soon as its object is successfully deleted; on a later failure, commit the consistent partial progress and leave untouched references retryable.

**Why:** External object deletion cannot be rolled back with a database transaction. Rolling back all database changes after one object has already been deleted leaves a valid-looking row that points to missing data, while an unlocked parent deletion can miss a concurrent attachment.

**How to apply:** Use this rule whenever deleting a parent whose child rows reference App Storage objects, and include tests for concurrent attachment plus failure after at least one successful deletion.

Commit a tombstone before deleting an externally stored object when a later database failure can restore the reference. Ordinary reads must exclude tombstones, and cleanup must resume them independently of object listings. Parent deletion intent also needs a durable marker so new children cannot attach between preparation and finalization.

**Why:** A database rollback cannot restore an object already deleted from App Storage. A committed tombstone makes every later failure recoverable, while a parent marker closes the transaction gap created by committing child tombstones before external deletion.

**How to apply:** Prepare deletion in one transaction, perform storage deletion and database finalization under the established lock order in a later transaction, accept object-not-found as an idempotent success, and test a real database failure after storage succeeds.

When an operation needs both a delivery-row lock and an object-path advisory lock, acquire the delivery row first and the path second.

**Why:** Attach already uses this order. Reversing it in manual deletion can deadlock when attach holds the delivery row while deletion holds the path.

**How to apply:** Keep attach and delete transactions on the same lock order, then re-read the photo after both locks before mutating storage or database state.

Never delete a rejected upload before authorizing its target operation. Before deleting any rejected object, take the same path lock used by attachment and confirm that no database row references it; unauthorized or unverifiable objects should be left to the orphan cleaner.

**Why:** A caller who can read an existing object path could submit it in a deliberately rejected request and otherwise trick cleanup into deleting a valid attached file.

**How to apply:** Authorize first, then validate and clean only known upload paths under the path lock. Test the storage side effect as well as the HTTP status.

For abandoned-upload cleanup on autoscale, an in-process timer must be paired with a catch-up check before issuing the next upload URL. Strict wall-clock cleanup while scaled to zero requires a separate Scheduled Deployment.

**Why:** Autoscale can stop every API process, so no timer exists while the service sleeps. No new upload can be created during that sleep, and a pre-upload catch-up prevents old orphaned objects from accumulating when uploads resume.

**How to apply:** Share one due coordinator between the timer and upload-URL route, coalesce concurrent callers, and retain cross-instance plus per-object database locks during deletion.

Acquire the cross-instance cleanup lock before listing App Storage objects.

**Why:** Autoscale can wake several API instances simultaneously. If each lists storage before the PostgreSQL try-lock, every instance pays for a full scan even though only one may reconcile or delete.

**How to apply:** In live cleanup, return immediately when the global try-lock loses; only the winner may call the storage listing API. Keep a test that asserts the losing path performs no list operation.

Bound the App Storage listing call with a timeout while the global lock is held. A timeout must fail the run, release the session lock, and fence the late listing result from reconciliation.

**Why:** A hanging list call otherwise blocks all cleanup instances indefinitely; allowing its late result to continue after unlock would run reconciliation without cross-instance ownership.

**How to apply:** Race the awaited listing against a bounded timer inside the lock callback, persist the attempt as failed, and test that a later run succeeds while resolving the old promise produces no reference reads or deletes.

When cleanup needs independent database commits, hold its global advisory lock at session scope and execute every local transaction through that same database client.

**Why:** A transaction-scoped global lock cannot survive per-object commits, while holding it on one pool connection and opening work on another self-deadlocks when the supported pool size is one.

**How to apply:** Check out one client, acquire the session lock, create the database facade on that client, run sequential per-object transactions, and always unlock before returning or destroy the client if unlock fails.

Fence cleanup-status persistence separately from the cleanup run itself.

**Why:** The run transaction releases its global advisory lock before the async caller persists the summary. A fixture or observer that acquires only the run lock can still race with that pending status write and overwrite a newer result.

**How to apply:** Persist every success/failure status under a dedicated status advisory lock. A controlled fixture must block new runs first, then acquire the status lock before snapshot/write/restore.

Failed cleanup attempts must preserve the timestamp of the last fully successful run, and persisted status must contain only aggregate counters.

**Why:** Operational health needs to distinguish the latest attempt from the last trustworthy reconciliation. Object paths and error text may expose private storage details and belong only in logs.

**How to apply:** On partial or total failure, update the attempt timestamp, failed status, and numeric counters without updating the successful-run timestamp. Keep detailed failures out of status writes.

Keep the cleanup `deleted` counter as the total of orphan deletion and tombstone recovery; expose recovery types as additive breakdown counters.

**Why:** Existing operators and consumers rely on `deleted` as the run total. Reinterpreting it as orphan-only would silently undercount and break historical comparisons.

**How to apply:** Increment `deleted` for every successful finalization, add subtype counters for resumed photo/delivery tombstones, and default new persisted counters to zero for existing status rows.