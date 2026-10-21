---
name: PostgreSQL query-failure fixtures
description: How to inject a database read failure through an instrumented pg client without hanging the request.
---

When a fixture wraps a pooled PostgreSQL client's query method, trigger a real driver error by forwarding a deliberately failing query through the original method. Do not replace the method result with a standalone rejected Promise.

**Why:** The pg/Drizzle request lifecycle depends on the original query machinery. A bare rejected Promise can surface the expected error but leave the surrounding HTTP test waiting indefinitely.

**How to apply:** For integration fixtures that must fail a specific read, detect and arm that query once, substitute invalid SQL or another deterministic driver-level failure, and call the captured original query method with the modified query.