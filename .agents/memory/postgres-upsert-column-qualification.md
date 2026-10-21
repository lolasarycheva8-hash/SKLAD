---
name: Qualifying PostgreSQL upsert counters
description: Why arithmetic in PostgreSQL ON CONFLICT updates must identify the existing target-table column.
---

In `ON CONFLICT DO UPDATE`, qualify an existing-row column used in an arithmetic expression with the target table rather than emitting a bare column name.

**Why:** PostgreSQL can resolve a bare column as either the existing target row or `EXCLUDED`, rejects the statement as ambiguous during analysis, and may reject even the insert path before a conflict occurs.

**How to apply:** For Drizzle upserts that increment counters, interpolate the schema column reference in `sql` so generated SQL names the target table. Cover the actual upsert with a PostgreSQL-backed test; a mock that treats every SQL object as a successful increment will miss this failure.