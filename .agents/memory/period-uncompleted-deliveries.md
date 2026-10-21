---
name: Period uncompleted deliveries
description: Why unfinished period deliveries cannot be computed by subtracting all actual deliveries
---
For «Не выполнено» in period summaries, evaluate deliveries planned within that period at its end.

**Why:** The existing completed total includes early deliveries planned for later dates. Subtracting it from the period plan could hide missed deliveries or yield negative counts.

**How to apply:** Keep the planned-period population and period-end cutoff when extending this metric; explain the difference in the summary help text.
