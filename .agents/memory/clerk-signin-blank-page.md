---
name: Clerk routing="path" blank page for internal-tool auth gating
description: When gating an entire internal app (no public landing page) behind Clerk, rendering <SignIn routing="path" path="/sign-in"> directly at "/" renders blank.
---

Clerk's `routing="path"` reads `window.location.pathname` directly and requires it to match the `path` prop exactly. Rendering the `<SignIn>` component inline at a different route (e.g. showing it as the signed-out fallback at `/`) causes a silent blank page — no console error.

**Why:** Clerk's internal router bails out when the DOM path doesn't match its configured `path`, and this failure is not surfaced as an error.

**How to apply:** For internal tools where the entire app (not just a landing page) is gated behind auth, redirect signed-out users to the dedicated `/sign-in` route (`<Redirect to="/sign-in" />`) instead of rendering `<SignIn>` inline at other paths.
