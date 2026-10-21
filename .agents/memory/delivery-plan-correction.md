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

The overview is distinct from daily schedule counters: the user requested a full-month plan (100%), cumulative completed and closed totals as of today, a period from the 1st through yesterday, and a separate today block. Each block's percentages use its own plan.

**Why:** The prior single row mixed denominators and was not clear to the user. They subsequently explicitly split today from the preceding period.

**How to apply:** Keep the full-month denominator stable when table filters change. The overview's period/today fact follows actual delivery dates; do not change the planned-day grouping of the daily schedule counters described above. Use Moscow calendar dates; on the 1st, the preceding period is empty. Closure is a subset of completed deliveries with approval by the block's cutoff.

The user confirmed the overview calculations are correct, but requires compact, equally sized blocks that leave space for the delivery table, not large metric cards.
They also requested reducing empty space in the Deliveries header between the title, action buttons, and tabs.

**Why:** The expanded summary occupied too much of the screen and was inconvenient for daily work.

**How to apply:** Preserve both denominator labels and the period dates; place detailed explanations in an optional hint rather than permanent multi-line text.

The user requested the same monthly and month-to-date overview as an Excel summary by driver, not just an export of the daily driver matrix.

**Why:** Their reference for the downloadable report was the two compact overview blocks.

**How to apply:** Use the overview's inclusive completed count (closed included) and separate month/period denominators in this report; do not substitute the daily matrix's mutually exclusive completed/closed statuses.

The Excel report should follow the user's supplied formatted workbook: period first (pale green), month second (pale blue), Calibri 12, thin borders, centered numbers, wrapped headers, frozen first column and four header rows.

**Why:** The user explicitly requested their uploaded workbook as the formatting reference, rather than the original plain export.

**How to apply:** Preserve this Excel-specific order even though the app overview shows month first. Red driver rows are interpreted as falling short of the period plan, matching the sample; do not bind formatting to specific names or row positions.

The user requires the Excel driver report to omit drivers absent from the selected delivery schedule (no assigned planned or actual deliveries).

**Why:** Listing unused accounts adds irrelevant zero rows.

**How to apply:** Filter by delivery assignments, not by completed totals or the elapsed-period plan; a driver with only future planned deliveries still belongs in the monthly report.