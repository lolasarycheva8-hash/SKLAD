---
name: Historical client-name repair
description: Resolve visual name collisions without guessing customer identity or merging their records.
---

Treat visually identical client names as a conflict to review, not proof that the records represent one organization. Prefer an administrator-approved distinct name for the selected stable ID; do not auto-merge clients or move their orders.

**Why:** Historical zero-width duplicates can belong to different real customers. A canonical name match is sufficient to block a new duplicate, but insufficient to decide who owns existing business records.

**How to apply:** Preserve stable client IDs and their links during repair. If an old object lacks clientId and its text matches multiple clients, require explicit ownership resolution before renaming. A true client merge needs a separate approved plan.