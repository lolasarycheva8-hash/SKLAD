---
name: Site change approval safety
description: Safety rules for any workflow that applies deferred or indirect changes to sites.
---

Any deferred or alternate path that changes an object must use the same `clients → sites` lock order as direct object writes, compare its captured baseline with current values before applying, and keep review history independent of object and user lifetime.

**Why:** A separate approval path can otherwise race client deletion or object deletion, overwrite a newer administrator edit, or erase the audit history when a referenced row is removed.

**How to apply:** Use this rule for approvals, queued imports, bulk corrections, or any future mutation that writes object fields outside the normal direct update route.

Logisticians with object-section access save object-card changes directly, without mandatory administrator approval. Retain the older approval workflow and its history for compatibility.

**Why:** On 2026-09-10, after clarification of direct saving versus approval, the user explicitly confirmed that logisticians should keep editing without administrator approval. They did not request deletion of existing proposals or review history.

**How to apply:** Do not reinstate mandatory approval merely because legacy proposal endpoints still exist. Keep their stale-baseline protections so an old proposal cannot overwrite a newer direct edit.