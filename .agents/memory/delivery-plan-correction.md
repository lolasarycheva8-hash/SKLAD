---
name: Informational plan corrections
description: Why a corrected delivery plan is separate from the operational schedule.
---

Treat the corrected planned date as reporting information, not as a replacement for the original plan.

**Why:** The user explicitly chose to keep the schedule and lateness calculations tied to the original date. A correction documents a changed expectation without changing the original performance baseline.

**How to apply:** Do not use the corrected date as a fallback or override in operational day selection, driver schedules, completion rules, or lateness calculations. Changing that meaning requires a new explicit product decision.

Daily totals in the delivery schedule must refer to the same original-planned-date group. Completion on a different actual date still belongs to its planned day's summary; actual-day throughput is not interchangeable with fulfillment of that day's plan.

**Why:** The user explicitly confirmed that the summary for 11 September must contain only deliveries whose plan is 11 September, after mixed date bases produced more closed deliveries than planned.

**How to apply:** Daily counters and their clickable filters use the same planned-date group. Plan equals done awaiting approval plus closed with approval plus not completed; fulfillment percent includes both done and closed. File presence alone does not establish closure.