---
name: Streaming binary downloads
description: How to preserve end-to-end streaming while still reporting source errors before a browser download starts.
---

For large binary exports, validate access, limits, database rows, and every backing Storage object in a lightweight preflight request, then start the real response with a native browser download. Do not finish a streamed server implementation with `fetch().blob()`.

**Why:** `fetch().blob()` buffers the complete response in browser memory, so server-side streaming alone does not protect the client. A native download avoids that buffer, but JavaScript cannot observe failures after it starts; checking only database rows can therefore produce a false success when a Storage object is missing.

**How to apply:** Make HEAD reuse the GET route's ACL, query, deletion filters, and limits, then verify all source objects with bounded concurrency and safe cancellation. Return a safe encoded error header for HEAD failures. After HEAD succeeds, launch the GET through a temporary same-origin link and describe success as “download started,” not “download completed.”