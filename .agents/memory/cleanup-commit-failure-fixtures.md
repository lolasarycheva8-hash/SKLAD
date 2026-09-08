---
name: Cleanup commit-failure fixtures
description: How to isolate PostgreSQL connection failures that must occur specifically on a cleanup COMMIT.
---

Arm the failure only after object deletion succeeds, then intercept the dedicated cleanup client's next COMMIT and discard that client from the pool.

**Why:** Closing the client inside the object-delete callback proves only that some later query fails. Cleanup catches per-tombstone failures and continues, so the surfaced error may come from a subsequent read rather than proving COMMIT was attempted.

**How to apply:** For transaction-boundary integration tests, use one dedicated pooled client, detect the actual COMMIT query, close only that client, assert COMMIT was reached, and recover through a fresh production dependency instance.