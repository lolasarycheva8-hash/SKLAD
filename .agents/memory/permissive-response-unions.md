---
name: Permissive response unions
description: Keep specific response variants from being swallowed by optional-object schemas.
---

Place specific variants before permissive all-optional objects in generated response unions, or use a genuinely discriminated union.

**Why:** The generic site-edit proposal schema accepted closure proposals first and stripped their dates and reason to an empty object, despite the request still being labelled as a closure.

**How to apply:** When extending an existing response union, verify the parsed response retains variant-specific fields, not just that TypeScript accepts the shape. Regenerate API schemas after changing union order.