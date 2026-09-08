---
name: Legacy similarity reviews
description: Privacy and staleness rules for persisting reviewed legacy-name similarity groups.
---

Persist a similarity review against both the group key and the sorted set of names that the administrator actually reviewed. If the membership changes, treat the group as unreviewed again.

**Why:** A new variant can join an existing formal similarity key later; suppressing its warning based on an older review would hide a genuinely new decision. The group key is derived from a human name, so putting it in a URL also leaks it into routine request logs.

**How to apply:** Send name-derived group keys in validated request bodies, not path/query strings. Compare the persisted member set with the current member set before reporting a group as reviewed.