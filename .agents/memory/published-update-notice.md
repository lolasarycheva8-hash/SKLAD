---
name: Published update notice
description: Preserve unsaved work when notifying users about a new published version.
---

Notify users about a changed published build without automatically reloading their page.

**Why:** Warehouse users may be editing orders or deliveries; publishing must not discard their in-progress input. The first rollout cannot notify tabs still running code from before this feature.

**How to apply:** Keep refresh user-initiated with a save-first warning. When explaining initial rollout, mention that users must load the feature once before subsequent releases can be detected.