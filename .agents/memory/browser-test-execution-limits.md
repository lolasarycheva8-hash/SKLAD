---
name: Browser test execution limits
description: Session-renewal checks must span short browser actions rather than one long wait.
---

Split long-lived session checks into short browser executions; do not wait for an entire token-renewal interval in a single action. Persist a narrowly scoped fixture cleanup journal outside the browser before uploading test files.

**Why:** A single 65-second wait exceeded an observed 45-second browser-worker execution limit and reset the browser. Authentication state was lost, and cleanup needed the recorded object identity rather than the now-unavailable browser.

**How to apply:** For renewal checks, retain timestamps across short actions and compare authenticated reads before and after the interval. If the browser resets, do not claim renewal passed. Clean up only journaled test objects, checking references in every database sharing the storage namespace before deletion.