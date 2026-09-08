---
name: Delivery completion workflow
description: Status ownership and act-approval rules for driver deliveries.
---

A delivery is Not completed until its assigned active driver explicitly marks it Done, regardless of whether its planned date is past, current, or future. "Plan for today/date" means the full assigned list for that selected day, not a delivery status. Done is an intermediate state and must stay orange even when an act is uploaded. The delivery becomes Closed and green only after a logistics editor reviews and approves at least one uploaded act.

**Why:** Uploading a file proves only that an act was submitted, not that logistics checked and accepted it. Keeping these stages separate prevents unreviewed deliveries from appearing closed.

**How to apply:** Driver actions must always re-check the current driver assignment. Closed deliveries are read-only for drivers. Adding or removing an act through an authorized logistics flow must never leave a stale approval state.