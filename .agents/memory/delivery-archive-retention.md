---
name: Delivery archive retention
description: User requirements for reversible delivery deletion and archive retention.
---

Delivery deletion by an administrator or authorized logistician means reversible archival, not permanent removal. Both roles may inspect archived deliveries and restore them regardless of whether their object is open or closed.

**Why:** The user explicitly requested an “Удалённые доставки” tab and the ability to correct accidental deletions without losing the delivery.

**How to apply:** Preserve original dates, fact, approvals, comments, and act files. Exclude archived deliveries from every operational list, driver route, dashboard, schedule, summary, and bulk export. Do not treat the archive as a physical-deletion cleanup queue. Month replacement and parent-object deletion must not silently erase archived records or their acts.