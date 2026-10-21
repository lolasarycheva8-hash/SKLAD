---
name: Backup recovery target
description: Approved recovery-point objective for backup planning; implementation is not implied.
---

The user accepts losing up to one day of changes after a serious incident, rather than requiring hourly or 15-minute recovery points.

**Why:** On 2026-09-22, the user explicitly chose the simpler daily option when discussing backup planning.

**How to apply:** Plan daily database and document-file backups around a 24-hour recovery-point objective. This is a planning constraint, not authorization to provision services or start backups, and not evidence of any active protection. Verify successful backup age and restoration rather than equating a scheduled run with a recovery guarantee.

The user subsequently authorized implementing encrypted database-and-document backups with an independent external destination and isolated restoration checks, rather than copying the other project's same-platform storage arrangement.

**Why:** On 2026-09-22, the user approved the recommendation after comparing it with a design that kept backups inside the original platform. Separation from the source project is an intentional recovery requirement, not an incidental provider choice.

**How to apply:** Do not substitute another directory in the source App Storage for the independent destination. Implementation authorization does not establish that cloud credentials, billing, schedules, alerts or a real restoration have been configured; report those separately.