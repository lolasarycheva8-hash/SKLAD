---
name: Orval generated-output churn
description: Why API codegen is post-normalized and can briefly break the live Vite import graph.
---

Keep the generated-output normalization step in the API-spec codegen pipeline unless the generator is verified to produce an equally stable result without it.

**Why:** Orval can emit long, non-semantic blank-line runs despite its formatting option. Its clean generation also briefly removes generated modules, so a running Vite server may log transient missing-file errors while regeneration is in progress.

**How to apply:** Judge codegen drift only after the full command finishes. Confirm a second generation is byte-identical, then restart the affected frontend workflow before treating transient missing-module logs as a real application failure.