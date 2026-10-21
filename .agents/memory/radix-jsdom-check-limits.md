---
name: Radix jsdom verification limits
description: Floating UI top-layer selectors recurse in jsdom; compatibility fix and teardown lifetime.
---

For real Radix Popper tests in this jsdom environment, handle the exact selectors `:modal` and `:popover-open` as false without entering the native selector matcher. Preserve all other matching and keep the shim for the entire isolated jsdom realm.

**Why:** A CPU profile identified recursion through nwsapi matches/isFullscreen while Floating UI isTopLayer checks `:modal`. This starves timers, including Vitest timeouts. Pointer polyfills, keyboard changes and React act adjustments cannot fix it. jsdom has no native top layer, so false is the appropriate compatibility result. Restoring the original matcher in afterAll reintroduces the hang through queued positioning callbacks after tests have passed.

**How to apply:** Keep this test-only; use real Radix interactions and bound the outer command with timeout plus kill-after. Distinguish this environment issue from the separate browser bug where a hidden select empty event cleared a newly created value; keep that behavioral regression test.