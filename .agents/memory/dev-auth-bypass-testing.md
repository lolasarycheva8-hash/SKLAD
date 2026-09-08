---
name: Dev auth bypass and role testing
description: DISABLE_AUTH bypass was removed for security; how RBAC testing worked and what to know now
---
Real Clerk authentication is mandatory for development and production; do not use an authentication bypass for local convenience.

**Why:** an authentication bypass that maps requests to an administrator can accidentally make the published application publicly writable.

**How to apply:** to e2e-test RBAC now, sign in with a real Clerk test user and flip that user's role in `app_users` (restore afterwards). Never re-add DISABLE_AUTH. Keep first-user recovery compatible with historical database copies that may contain a non-login technical row.
