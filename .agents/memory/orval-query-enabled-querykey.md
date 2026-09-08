---
name: Orval list hooks require queryKey with custom query options
description: Passing { query: { enabled } } to some Orval-generated list hooks fails TS2741
---

Some Orval-generated list hooks in `@workspace/api-client-react` type their query options as requiring `queryKey`, so `{ query: { enabled } }` alone fails typecheck (TS2741).

**Why:** the generated `UseQueryOptions` for those hooks is not `Partial`, unlike some getter hooks where `{ query: { enabled } }` works.

**How to apply:** when passing `enabled` (or other options) to a list hook, also pass `queryKey: get<Op>QueryKey(params)` with the same params object.
