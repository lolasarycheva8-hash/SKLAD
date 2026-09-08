---
name: Preview/apply identifier normalization
description: Keep preview aggregation and mutation matching equivalent when migrating legacy text identifiers.
---

Any workflow that previews legacy text groups and later applies mappings must use one explicit canonical form for aggregation, duplicate detection, and mutation matching.

**Why:** Different SQL and application whitespace rules can produce a row with a nonzero preview count that the apply operation silently updates as zero, especially with copied or imported tabs and non-breaking spaces.

**How to apply:** Define the accepted edge-character set once in equivalent SQL and application canonicalizers, use it at every preview/apply boundary, and cover uncommon whitespace plus concurrent apply requests in integration tests. Build PostgreSQL control characters with explicit `chr(...)` values: its escape string does not treat `\v` as vertical tab and can trim literal `v` characters instead. Detect canonical duplicates by checking and populating the set in the same pre-mutation pass.