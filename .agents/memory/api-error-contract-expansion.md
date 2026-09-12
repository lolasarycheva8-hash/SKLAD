---
name: Expanding API error contracts
description: How to avoid missed test expectations when an existing API error gains structured fields.
---

When an existing API error response gains structured fields, search the full test suite for both its status and stable message before running validation; the same response may be asserted in scenarios unrelated to the feature name.

**Why:** Exact whole-object assertions can remain in broader normalization or race-condition tests and fail even when the new contract and primary feature test are correct.

**How to apply:** Before validating any expanded non-2xx response, update all intentional exact-response assertions or replace them with focused checks that still enforce the contract fields relevant to each scenario.