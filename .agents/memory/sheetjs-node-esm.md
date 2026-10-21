---
name: SheetJS filesystem access under Node ESM
description: Spreadsheet inspection through the installed ESM build needs explicit filesystem reads.
---

When inspecting uploaded spreadsheets in Node ESM, pass bytes from node:fs to XLSX.read rather than assuming XLSX.readFile has filesystem access.

**Why:** The installed SheetJS ESM build reported “Cannot access file” for an existing readable workbook because its filesystem adapter was not initialized. That message did not indicate a missing file or damaged workbook.

**How to apply:** Verify the path and size, read bytes with fs.readFileSync, then inspect only sheet names, headers and a small row sample.