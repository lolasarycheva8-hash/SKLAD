---
name: Correcting an active monthly schedule
description: Preserve driver work and order identity when importing a revised monthly Excel schedule.
---

Revised monthly spreadsheets are corrections, not authority to replace delivery history. Keep fact dates, acts, approvals, notes, and order links; keep deliveries omitted from the file. Never infer a primary schedule delivery from an order-specific delivery at the same shop.

**Why:** The user needs to upload corrected October schedules after drivers have already completed deliveries and uploaded acts, without losing their work.

**How to apply:** Preview changes before applying them; preserve existing delivery identities, require explicit selection for new deliveries, protect completed/billed deliveries, and send ambiguous matches for manual resolution. Ignore fact-date columns in schedule-correction imports. Recalculate and require confirmation if the reviewed data changes before saving.
