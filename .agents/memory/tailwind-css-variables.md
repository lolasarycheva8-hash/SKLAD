---
name: Tailwind CSS variable compatibility
description: Legacy arbitrary-value shorthand can silently generate invalid CSS with Tailwind 4.
---

Use explicit `var(--name)` inside arbitrary-value utilities when referencing CSS custom properties.

**Why:** Legacy bracket shorthand compiled without a build error but emitted an invalid max-height declaration. Long Radix menus then exceeded the screen instead of constraining their scroll viewport.

**How to apply:** For CSS regressions after framework upgrades, inspect the generated CSS, not just TypeScript or a successful build; these checks do not validate CSS property values.