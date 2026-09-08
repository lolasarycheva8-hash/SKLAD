---
name: Express route-prefix guards
description: Prevent case-variant URLs from bypassing authorization middleware on root-mounted Express routers.
---

When Express string routes use their default case-insensitive matching, guard the route family with a string-prefix middleware that has the same semantics. Do not pair them with a case-sensitive regular-expression prefix.

**Why:** A differently cased URL can skip a regex guard while still matching the following Express string route, turning capitalization into an authorization bypass.

**How to apply:** For a root-mounted section router, use a segment-aware string prefix such as `router.use("/sites", guard)` or attach the guard directly to every route. Include mixed-case denial checks for protected route families.