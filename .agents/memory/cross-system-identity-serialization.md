---
name: Serializing cross-system identity changes
description: How to keep authentication-provider identity data consistent with the application database during administrator edits.
---

For identity fields shared with an external authentication provider, acquire a PostgreSQL session advisory lock per user and keep it through the provider call, database transaction, and any compensation.

**Why:** Releasing a transaction-scoped lock before compensation lets a failed older request undo a newer successful request. Using another pool connection for the transaction can also deadlock when the pool has only one connection or is saturated.

**How to apply:** Run the database transaction on the same connection that owns the session lock. Confirm provider state after ambiguous network failures. If lock acquisition or unlock is uncertain, destroy that connection instead of returning a potentially locked session to the pool.