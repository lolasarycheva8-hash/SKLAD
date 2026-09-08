---
name: Undated deliveries
description: Product rules for deliveries added to a monthly schedule before their exact day is known.
---

An undated delivery still belongs to the month in which the logistician added or imported it. Monthly replacement must preserve existing undated deliveries and must not duplicate them.

**Why:** Some sites need to appear in the monthly schedule before the exact delivery day is known; treating the date as the month owner would make these rows disappear or become impossible to replace safely.

**How to apply:** Keep month ownership separate from the nullable planned date. Continue requiring an assigned driver. Show undated rows in a dedicated logistics group, allow the logistician to assign a day later, and block completion until a day is assigned.