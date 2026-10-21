---
name: Git and connector authorization
description: Distinguish native Git credentials from the authenticated GitHub connector.
---

Treat native Git authorization and the Replit GitHub connector as separate access paths.

**Why:** Native push rejected its credential while the existing connector successfully authenticated and retained repository write permission. Reconnecting the working connector would not address the observed Git failure.

**How to apply:** Check the connector through its authenticated API before concluding that GitHub access is unavailable. A snapshot uploaded through the Git Data API should be verified against the local Git tree hash before reporting that every tracked project file was transferred.