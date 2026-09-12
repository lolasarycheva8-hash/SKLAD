---
name: Delivery completion workflow
description: Status ownership and act-approval rules for driver deliveries.
---

In the driver's workflow, a delivery is Not completed until its assigned active driver explicitly marks it Done, regardless of whether its planned date is past, current, or future. A logistician with delivery-edit permission may also record the actual delivery date directly; the user explicitly prioritizes this alongside act upload on phones. "Plan for today/date" means the full assigned list for that selected day, not a delivery status. Done is an intermediate state and must stay orange even when an act is uploaded. The delivery becomes Closed and green only after a logistics editor reviews and approves at least one uploaded act.

**Why:** Uploading a file proves only that an act was submitted, not that logistics checked and accepted it. Keeping these stages separate prevents unreviewed deliveries from appearing closed.

**How to apply:** Driver actions must always re-check the current driver assignment. Closed deliveries are read-only for drivers. Adding or removing an act through an authorized logistics flow must never leave a stale approval state.

Delivery text fields have separate owners: the assigned driver owns the driver comment, while a logistician owns the note shown to that driver. Each role may read both fields but may edit only its own field; administrators must not silently become authors of either role-specific message.

**Why:** A shared editable note makes it impossible to distinguish operational instructions from the driver's report and lets one role overwrite the other's text.

**How to apply:** Keep separate persisted fields and write endpoints. Desktop logistics views show the driver comment read-only; driver views show the logistician note read-only. Enforce ownership in API authorization, not only by hiding controls.