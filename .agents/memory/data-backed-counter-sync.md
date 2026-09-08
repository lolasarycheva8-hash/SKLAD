---
name: Synchronizing data-backed UI counters
description: Avoid reading React Query-backed counters while they still show their initial default.
---

In browser smoke tests, wait until a counter reflects a fixture-guaranteed value before capturing it or deriving later expectations. Element existence alone is insufficient when the component renders immediately with an empty-array or zero default.

**Why:** A protected page rendered its admin action promptly with `(0)`, then updated after the query resolved. Reading the first render made a valid post-mutation `(0)` look wrong because the test had derived an expected value of `-1`.

**How to apply:** When a fixture guarantees at least one row, synchronize on a positive counter or the fixture row itself before recording the baseline. Continue to verify the post-mutation counter from that loaded baseline.

Release validation can run under enough parallel load that headless Chromium needs substantially longer than a local manual run to open its DevTools port. Keep startup budgets separate from UI assertion budgets and avoid relying on `/dev/shm`.