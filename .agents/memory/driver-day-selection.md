---
name: Driver day selection
description: Preserve explicit date selection and act uploads when Moscow day changes
---
Driver pages follow the new Moscow date only while in today-following mode. Explicit historical or future selections remain fixed, even if a future selection becomes today's date. Selecting today's date again resumes following.

**Why:** An automatic refresh must not interrupt review of another date or move the target of an act upload. Device timezone must not disagree with the server's Moscow business day.

**How to apply:** Refresh the clock on midnight and returning from background without remounting the page or replacing the selected act/comment delivery.
