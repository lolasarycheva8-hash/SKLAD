---
name: Additive role-schema publishing
description: How to publish the role migration without PostgreSQL enum transaction failures or losing legacy assignment data.
---

Keep database defaults on the pre-existing `viewer` enum value until every production database has committed the new role values. Normalize `viewer` to manager in application reads and write canonical roles explicitly.

**Why:** Replit Publish applies the generated schema diff transactionally. PostgreSQL rejects using a newly added enum value as a column default before that transaction commits.

**How to apply:** Do not switch a DB default to a newly introduced role in the same release that adds the enum value. Keep populated legacy columns in the schema as unused archival fields when their types or meanings do not safely map to replacements; remove them only in a later, explicit data-migration release.