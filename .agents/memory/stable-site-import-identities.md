---
name: Stable IDs in mixed site imports
description: Identity and ordering rules when one bulk site import mixes stable IDs with legacy name-only rows.
---

Bulk edits that can rename objects must identify existing rows by stable ID. When a file also permits legacy rows without IDs, resolve those name-based targets against the database snapshot before applying any ID-based rename, and reject any overlap between the two target sets.

**Why:** Applying ID-based renames first can free an old name; a later name-only row may then create a new object instead of updating the object that had that name when the import began.

**How to apply:** Use this rule whenever an object import supports both backward-compatible name matching and stable-ID updates. Validate all targets before the first write and keep the operation transactional.