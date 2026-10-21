---
name: Logistician catalogue and order access
description: Role-wide access requested for products/orders, with categories read-only.
---

Treat products and orders as role-wide read/edit access for logisticians, not as a one-off assignment to a particular account. Category management remains administrator-only, including the category controls embedded in product forms.

**Why:** The user requested these capabilities for the logistician role, explicitly limiting categories to viewing. Products and categories historically shared a permission, so granting product editing alone would accidentally grant category writes.

**How to apply:** Preserve the distinction in both UI and API. Other sections retain their existing assignment rules; do not broaden all logistician permissions or modify existing users just to apply these role defaults.