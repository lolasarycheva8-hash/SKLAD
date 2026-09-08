---
name: Drivers are application users
description: Canonical identity and access rule for drivers throughout the warehouse product.
---

Every driver must be an application user explicitly marked as a driver. Objects, deliveries, shipments, imports, filters, and access checks must use the application user's UUID; a display name is presentation only.

**Why:** Driver access to mobile workflows, assigned deliveries, and private delivery acts must remain correct when names change or collide. Free-text names cannot provide a secure identity.

**How to apply:** New driver selectors must read from driver-marked users. Authorization must require both the matching user UUID and an active driver flag. Removing that flag must also remove active assignments.