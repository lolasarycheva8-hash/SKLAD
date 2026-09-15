---
name: Additional delivery orders
description: Product rules for supplementary client orders linked to a primary delivery.
---

An additional order is a new client order plus a separate delivery linked to the selected original delivery. Save both atomically, only after the user chooses a different delivery type and finishes the goods form.

**Why:** The user requested creating additional orders from Logistics while keeping them visible in Client Orders and independently executable in the delivery schedule.

**How to apply:** Copy planning and assignment data, not completion, approval, driver comments, or acts. Keep primary and additional delivery completion independent. Show “ДОП.ЗАКАЗ” and product quantities to logistics and to the driver assigned to the additional delivery; do not expose a reassigned child’s contents through its parent. Preserve additional orders during ordinary monthly schedule replacement. Keep ordinary schedule duplicate protections rather than permitting arbitrary duplicate primary deliveries.