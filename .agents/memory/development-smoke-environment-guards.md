---
name: Development smoke environment guards
description: Reliable safeguards for destructive development-only smoke tests in this Replit workspace.
---

Do not use `REPLIT_ENVIRONMENT` to identify a development workspace here: it can report `production` during development. Do not require `DATABASE_URL` and `REPLIT_DB_URL` to match either; Replit can expose different endpoints for the same development database.

**Why:** A release smoke test initially rejected the real development workspace when it used those values as positive environment checks.

**How to apply:** For a development-only test that creates temporary data, combine an explicit mutation opt-in with a test-mode external-service key and require the current `REPLIT_DEV_DOMAIN`; constrain any target URL override to that exact development host.