---
name: Wouter query strings
description: Correctly reading URL query parameters in the warehouse app's default Wouter router.
---

With the default Wouter router used by this app, treat `useLocation()` as pathname/navigation state and read the query string through `useSearch()`.

**Why:** Splitting the value returned by `useLocation()` on `?` silently yields no parameters, so URL-driven filters appear implemented but never activate after navigation.

**How to apply:** Use `useSearch()` plus `URLSearchParams` for query-backed filters or prefilled forms, and cover the destination page with a test that supplies the real search string.