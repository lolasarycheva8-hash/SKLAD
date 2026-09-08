---
name: Verifying async DESIGN subagent completion
description: An async DESIGN subagent can report workflow status "success" while its own completion message admits the work is partial (e.g. "next steps: complete X, Y, Z"). Don't trust the status field alone.
---

When a background/async subagent finishes, read its completion message text, not just the workflow status. A "success" status only means the subagent process exited cleanly — it does not mean the requested feature/pages are fully built.

**Why:** A DESIGN subagent tasked with building a full multi-page frontend returned "success" but had only scaffolded the app shell (theme, routing stub, shadcn components) and left the actual pages unbuilt, with its own message listing unfinished next steps. Restarting the frontend workflow and screenshotting still showed a "building..." placeholder.

**How to apply:** After any async subagent completes, before restarting workflows or presenting to the user: (1) read its completion message in full for hedging language like "next steps" or "remaining"; (2) spot-check the actual files it was supposed to produce (e.g. list expected page/component files); (3) screenshot the live app before declaring the task done. If incomplete, finish the remaining work directly rather than assuming the subagent will resume.
