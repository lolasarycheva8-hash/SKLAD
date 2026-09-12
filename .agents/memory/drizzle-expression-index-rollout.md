---
name: Drizzle expression-index rollout
description: How to safely change an existing PostgreSQL expression index managed by Drizzle push.
---

Do not rely on Drizzle push to replace an expression index when its name is unchanged. Roll out the changed expression as a newly named additive index, then verify the actual definition in PostgreSQL before depending on it. Before publishing a complex expression index, also inspect the generated production schema diff: Publish may fail to serialize nested `regexp_replace` expressions even when PostgreSQL and development Drizzle push accept them.

**Why:** Drizzle push reported success after an expression changed, but `pg_indexes` showed that the old expression was still installed under the reused name. In a later rollout, Publish truncated a valid nested regular-expression index definition and rejected the migration during validation.

**How to apply:** Before creating the new unique index, report canonical collisions while writes are blocked in the same transaction. Add the newly named index, verify its definition through PostgreSQL metadata and `explainSchemaDiff`, and remove the redundant legacy index only in a later rollout. If Publish cannot round-trip the expression, stage a simple column-backed uniqueness design instead of retrying the same expression syntax.