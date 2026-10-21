---
name: Constraint rollout on existing data
description: Safe ordering for adding PostgreSQL constraints to tables that already contain user data.
---

Production schema changes belong exclusively to Publish. Never run schema migration scripts or Drizzle push in production build hooks or at application startup. Development post-merge preparation is separate. Keep API behavior compatible before and after a constraint until rollout is complete.

**Why:** Build-time schema mutations can invalidate the migration already validated by Publish. A failed Promote can coexist with already changed production constraints, so a failed publication does not prove the database is untouched. An immediately validated foreign key also cannot rely on repairs that only run later at startup.

**How to apply:** Inspect production read-only and inspect the actual Publish diff. Stage prerequisite uniqueness before dependent foreign keys if the generated order is wrong. Resolve historical-data compatibility before adding constraints through Publish; do not bypass production read-only access with custom scripts.

Before retiring a one-off migration, separate obsolete data repair from enduring database constraints and ensure those constraints are represented in the declarative schema.

**Why:** A migration can be the only source of an essential foreign key even after its backfill is no longer needed. Deleting the migration without preserving that constraint leaves fresh development databases and future schema pushes without the intended protection.

**How to apply:** Compare the migration's DDL with the ORM schema during migration cleanup; retain permanent constraints without retaining startup or CLI data repair.