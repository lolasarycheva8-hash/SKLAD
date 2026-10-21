---
name: Clerk actor-session switching
description: Reliable browser transition between an administrator session and a Clerk actor session.
---

Consume short-lived Clerk actor and return tickets from an unprotected transition route that stays mounted while the current session ends and the replacement session becomes active.

**Why:** Ending a session from a protected page immediately unmounts that page and can interrupt ticket consumption. Clerk's external actor-token URL can also reject changing Replit development origins, even when the ticket itself is valid.

**How to apply:** Keep actor tickets short-lived and out of logs, queue them only for the immediate transition, perform both directions through the unprotected route, and preserve the artifact path when navigating afterward.