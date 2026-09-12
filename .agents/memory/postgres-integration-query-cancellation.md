---
name: Cancelling PostgreSQL integration fixtures
description: How to inject a deterministic query failure inside a transaction without leaving asynchronous pool errors.
---

For an integration fixture that must fail a specific in-transaction query, have a temporary trigger acquire a known advisory lock before pausing. Use the granted advisory lock to identify the route's backend, block the target table, wait until that backend requests the lock mode expected from the target query, then call `pg_cancel_backend`.

**Why:** Matching `pg_stat_activity.query` is brittle because prepared SQL text varies or may be hidden. A generic lock wait can also be a foreign-key check in the write itself, creating a false-positive rollback test. `pg_terminate_backend` can leave the Node PostgreSQL pool emitting an uncaught asynchronous connection error after the test has otherwise passed.

**How to apply:** Use this only for database-backed integration tests that need to prove transaction boundaries around post-write work. Put the synchronization marker after the write and its constraints (for example, an `AFTER UPDATE` trigger), then inspect the ungranted relation-lock mode (`AccessShareLock` for a plain `SELECT`) before cancellation. Always remove temporary triggers/functions and release the blocking connection in `finally`.