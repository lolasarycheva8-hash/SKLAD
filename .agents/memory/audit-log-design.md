---
name: Audit log design
description: How the append-only audit trail works in the warehouse app and why it's shaped this way.
---

# Audit log (Журнал действий)

An append-only trail of every successful write, recorded by an Express middleware at the `/api` boundary.

**Key decisions:**
- Middleware records on `res.finish` and only when `res.statusCode < 400`, so failed/rejected writes are not logged and logging never blocks the request.
- Must be mounted **after** `requireAuth` so `req.appUser` is populated — otherwise entries have no user.
- Append-only is enforced at the application level only (no edit/delete route), not by DB constraints.
- `entityId` is parsed from the URL and set **only** for canonical ids (UUID or numeric). Sub-action words like `invite`, `bulk`, `receipt`, `done`, `delete` must resolve to `entityId = null` — do not treat every second path segment as an id.
- Body snapshot capped at 4KB (`meta`); larger payloads (bulk imports) stored as a truncated summary to avoid table bloat.

**Why:** internal staff tool for ~1000 users; admin (Lola) needs to see who changed what to recover from human error. Read path is admin-only (`GET /api/audit`, `requireAdmin`).

**How to apply:** any new write route is captured automatically — no per-route wiring. If you add nested action routes, verify the sub-action doesn't get mislabeled as `entityId` (the ID_PATTERN check handles this).
