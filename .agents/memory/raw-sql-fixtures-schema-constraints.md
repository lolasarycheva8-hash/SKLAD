---
name: Raw SQL fixtures and schema constraints
description: Why release fixtures must be checked after applying final database constraints locally
---

Apply final schema constraints to the development database before running release smoke tests, and update every direct-SQL fixture in lockstep with new required columns.

**Why:** TypeScript and API contract checks cannot detect raw SQL inserts that omit a newly required database field. Such fixtures can remain green until the local constraint is actually applied.

**How to apply:** For staged nullability rollouts, first clear development legacy rows, apply the final constraint locally, then run release smoke tests against that constrained schema before publishing.