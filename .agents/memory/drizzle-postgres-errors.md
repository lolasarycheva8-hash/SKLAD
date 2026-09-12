---
name: Drizzle PostgreSQL errors
description: How to recognize expected PostgreSQL constraint conflicts through Drizzle wrappers.
---

When translating an expected PostgreSQL constraint violation into an API response, inspect the error and its `cause` chain. Match both the PostgreSQL code and the exact constraint name rather than accepting every unique violation.

**Why:** The installed Drizzle stack can throw `DrizzleQueryError` at the top level while PostgreSQL fields such as `code = 23505` and `constraint` exist only on the wrapped cause. A top-level-only predicate silently turns a known conflict into a 500.

**How to apply:** Make the integration test deterministically execute the constraint-violation path; a preflight existence check can otherwise return the same 409 while leaving the wrapped-error handler untested.