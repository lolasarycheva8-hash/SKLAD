---
name: Locale formatting is not a month wire format
description: Cross-browser date formatting can produce a non-ISO month and break delivery requests.
---

Never derive a YYYY-MM request value by slicing an Intl.DateTimeFormat formatted string, even with the en-CA locale. Assemble numeric year/month parts explicitly and validate month input at the API boundary.

**Why:** A Safari screenshot showed 09/2026 while production delivery requests failed in monthRange with Invalid time value. Locale output is browser-dependent, not a stable serialization contract; the resulting server error appeared as an empty delivery list.

**How to apply:** Preserve Europe/Moscow month ownership, use formatToParts for current-month defaults, and test localized output and a UTC/Moscow month boundary. Report load errors explicitly instead of rendering zero deliveries.

Do not rely on an invisible native month input as the only way to navigate historical schedules.

**Why:** A Safari user could not reopen September after October began, while September deliveries still existed and permissions did not restrict past months. The exact device-specific native picker failure was not reproduced; native input support/fallback remains a compatibility risk.

**How to apply:** Keep a visible month/year selection and previous/next controls usable without a native month picker. Ongoing prior-month work must remain accessible; never move deliveries into the current month to address a navigation problem.