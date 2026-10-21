---
name: Production data backfills
description: How to carry safe historical-row backfills from development into production when Publish only applies schema differences.
---

Replit Publish applies schema differences but does not replay development data changes. For a required historical-row repair, use narrowly scoped, idempotent DML during application startup after the required table and columns already exist. Keep the same operation available to the development post-merge setup.

**Why:** A development-only post-merge script repairs development but leaves existing production rows unchanged after Publish. Custom production schema migration scripts and deployment-time DDL are unsupported.

**How to apply:** Restrict the update to rows missing the derived value, preserve unresolved/orphaned rows, fail startup explicitly if the required backfill cannot run, and verify that a second execution updates zero rows.