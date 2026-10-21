---
name: Delivery completion workflow
description: Status ownership and act-approval rules for driver deliveries.
---

In the driver's workflow, a delivery is Not completed until its assigned active driver explicitly marks it Done, regardless of whether its planned date is past, current, or future. A logistician with delivery-edit permission may also record the actual delivery date directly; the user explicitly prioritizes this alongside act upload on phones. "Plan for today/date" means the full assigned list for that selected day, not a delivery status. Done is an intermediate state and must stay orange even when an act is uploaded. The delivery becomes Closed and green only after a logistics editor reviews and approves at least one uploaded act.

**Why:** Uploading a file proves only that an act was submitted, not that logistics checked and accepted it. Keeping these stages separate prevents unreviewed deliveries from appearing closed.

**How to apply:** Driver actions must always re-check the current driver assignment. Closed deliveries are read-only for drivers. Adding or removing an act through an authorized logistics flow must never leave a stale approval state.

Drivers may mark completion at the shop and upload acts later at home. Keep completed addresses in the selected day's route without moving them on completion. The missing-act reminder and «Выполнено без акта» list must use the selected date's schedule month, not all history. Direct act upload before completion must ask for an explicit actual date, not silently use the planned date, and save completion only together with a successfully attached act.

**Why:** The user approved both modes after drivers reported losing addresses when marking deliveries done before uploading acts.

**Why month-scoped reminders:** The user explicitly requested that the count change with the selected month after historical missing acts made the driver's reminder disagree with the October logistics list.

**How to apply:** Keep route membership independent of workflow status. File selection or failed upload must not mark completion; uploading an act still does not close the delivery without logistics approval.

Aggregate «Выполнено» includes both done and closed deliveries; «Закрыто» is a subset, not an additional disjoint group.

**Why:** The user explicitly clarified that completed counts must include deliveries with and without an approved act. Exclusive counts made «Закрыто» appear larger than «Выполнено».

**How to apply:** Use the inclusive definition in summary badges, daily schedule totals and completed filters. Compute completion percentages without adding closed a second time. Keep the underlying done/closed workflow states distinct.

«Закрыто за период» uses the actual delivery date and the current approval status, not approval before the period cutoff. Approval on October 7 of an October 2 delivery must increase the October 1–6 closed count.

**Why:** The user explicitly chose current agreement status rather than a historical end-of-period snapshot.

**How to apply:** Use current closed status within actual-date groups consistently in the summary and its exports; do not exclude later approvals.

Delivery text fields have separate owners: the assigned driver owns the driver comment, while a logistician owns the note shown to that driver. Each role may read both fields but may edit only its own field; administrators must not silently become authors of either role-specific message.

**Why:** A shared editable note makes it impossible to distinguish operational instructions from the driver's report and lets one role overwrite the other's text.

**How to apply:** Keep separate persisted fields and write endpoints. Desktop logistics views show the driver comment read-only; driver views show the logistician note read-only. Enforce ownership in API authorization, not only by hiding controls.