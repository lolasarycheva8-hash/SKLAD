---
name: Orval generated-output churn
description: Orval clean generation can briefly break the live Vite import graph.
---

Use Orval's native Prettier formatter and judge generated output only after the complete generation command finishes.

**Why:** Orval's clean generation briefly removes generated modules, so a running Vite server may log transient missing-file errors while regeneration is in progress.

**How to apply:** Judge codegen drift only after the full command finishes and confirm a second generation is byte-identical before treating transient missing-module logs as a real application failure.