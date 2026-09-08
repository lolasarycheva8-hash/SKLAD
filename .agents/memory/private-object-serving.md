---
name: Private object serving must be allow-listed
description: Object-storage template serves any private object to anyone; register-and-check pattern used in this app
---
The Replit object-storage template's `GET /storage/objects/*` ships with auth/ACL commented out and its upload route checks passport-style `req.isAuthenticated()` (always false under Clerk → 401).

**Why:** architect review flagged that any authenticated user could read arbitrary private objects by guessing paths, and attach foreign objects as delivery photos.

**How to apply:** when adding new upload features: (1) replace the template's session check with `req.appUser`; (2) serve private objects only if the path is registered in an app table (e.g. delivery_photos), else 404; (3) on attach, validate path matches `/objects/uploads/<id>` and reject paths already attached elsewhere.
