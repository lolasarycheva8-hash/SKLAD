---
name: SheetJS CSV fixtures in jsdom
description: Reliable construction of CSV File fixtures read repeatedly by SheetJS in Vitest/jsdom.
---

Construct CSV `File` fixtures with `XLSX.write(..., { bookType: "csv", type: "array" })` rather than manually wrapping `TextEncoder` output in an `ArrayBuffer`.

**Why:** In Vitest/jsdom, a manually encoded CSV buffer returned from an overridden `file.arrayBuffer()` produced an empty header row when the application read the same file through SheetJS, although parsing the bytes directly in Node worked. SheetJS-generated array bytes behave consistently through the browser file-input path.

**How to apply:** For UI tests that upload CSV through an input and then call SheetJS, generate the CSV workbook bytes through SheetJS too. Set `FS` explicitly when the delimiter matters, and represent dates as ISO strings before writing CSV.