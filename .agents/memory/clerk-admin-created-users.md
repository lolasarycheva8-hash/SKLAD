---
name: Clerk admin-created password accounts
description: Gotchas when the admin creates Clerk users with passwords instead of e-mail invitations
---

- Backend-created Clerk users get an **unverified** email; sign-in then demands an emailed code. Fix: after `users.createUser`, call `emailAddresses.updateEmailAddress(id, { verified: true })`.
- Even with a verified email, Clerk's **device verification (client trust)** can still ask for an emailed code on a new device/browser. It is managed by Clerk and cannot be disabled; real employees receive the code at their real mailbox. Playwright-based e2e cannot pass it — use programmatic login instead.
- Treat Clerk creation + our DB insert as a compensating pair: on any failure after the Clerk user exists, delete it, or the email is stuck "taken" in Clerk with no app-side row.
- Map Clerk error codes for UX: `form_identifier_exists` → 409 duplicate; `form_password*` → 400 weak/compromised password (HIBP check active).

**Why:** invitation e-mails proved unreliable for the user; admin-created login+password accounts replaced them (Aug 2026).
