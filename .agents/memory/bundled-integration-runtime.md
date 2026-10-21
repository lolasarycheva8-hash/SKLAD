---
name: Bundled integration runtime imports
description: Production runtime import side effects in temporary integration bundles.
---

In route integration tests, replace external cleanup effects before importing the production cleanup runtime, rather than importing the runtime to mock its coordinator afterward.

**Why:** Importing the runtime initializes the production logger; bundled tests under /tmp cannot resolve its pino-pretty transport target, so execution fails before the mock can be installed. More importantly, tests of upload permissions must never trigger real cleanup.

**How to apply:** Keep authorization real, isolate external effects behind a small replaceable dependency, and restore any replacements in finally.