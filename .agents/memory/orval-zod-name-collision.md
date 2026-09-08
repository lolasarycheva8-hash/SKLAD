---
name: Orval schema/const naming collisions
description: OpenAPI schema names colliding with generated zod const names cause TS2308 re-export errors
---

When adding a new OpenAPI response schema, avoid names that duplicate an existing generated zod const identifier (e.g. a schema named `InviteUserResponse` collided with another generated const, producing `TS2308: Module ... has already exported a member named ...` in `lib/api-zod/src/index.ts` barrel exports).

**Why:** Orval generates one zod const per schema and re-exports them all from a barrel file; two schemas that produce the same const name silently break the build with a re-export conflict that's confusing to trace back to the OpenAPI spec.

**How to apply:** If codegen (`pnpm --filter @workspace/api-spec run codegen`) or `typecheck:libs` reports TS2308 in `lib/api-zod/src/index.ts`, check for a schema name collision in `openapi.yaml` first — rename the OpenAPI schema (not the generated code) and re-run codegen.
