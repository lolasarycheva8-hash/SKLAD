---
name: Radix jsdom verification limits
description: Interpreting stalled Select interaction tests without confusing them with browser failures.
---

Do not treat a stalled jsdom Radix Select interaction as proof of an application failure or as a passing check.

**Why:** Real Select interaction tests have stalled after opening or selecting a create-new option, even after DOM polyfills and keyboard interaction allowed a simple existing-value selection to pass. Lowering the test timeout did not reliably bound the run. A real-browser pass also found a genuine selection-reset bug in the same flow. Fixing that browser bug did not resolve the jsdom stalls, so do not conflate their causes or dismiss the unverified flow as merely a test-environment issue.

**How to apply:** Bound the overall shell run, separate verified API/typing results from incomplete UI verification, and avoid repeating broad suites while investigating the same interaction. Use a focused real-browser check when confidence in the actual create flow is needed.