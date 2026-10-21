---
name: Product import identity
description: Safety tradeoff for repeat imports of goods without article numbers.
---

For goods without an SKU, repeat imports may match only an unambiguous normalized name among goods also lacking an SKU. Repeated names within a file need distinct SKUs or removal of the redundant row; never pick a row by position or silently merge it.

**Why:** A real import with all SKUs blank overwrote the same product repeatedly, retaining only the final row. Names alone cannot distinguish two genuinely different goods, so explicit rejection is preferable to silently losing a row.

**How to apply:** Keep batch validation and atomic writes, show actionable row numbers on ambiguity, and count created versus updated products separately. Re-importing must not credit initial stock again. Do not repair or reload production inventory without explicit permission.

Never rely solely on JavaScript lowercasing to detect identities subsequently matched using PostgreSQL lowercasing. Enforce distinct resolved product IDs within the transaction.

**Why:** JavaScript lowercases `İ` to `i` plus combining dot, while this database matches `İ` and `i` after lowercasing. A batch can pass the JavaScript duplicate check yet target its own newly inserted row.

**How to apply:** Reject and roll back any second input resolving to an already-used product ID, irrespective of why the canonicalizers differed.