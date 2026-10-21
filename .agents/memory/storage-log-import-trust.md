---
name: Storage log import trust
description: Why imported log builders need explicit review rather than inferred safety.
---

Keep imported structured-log builders fail-closed instead of recursively interpreting arbitrary dependencies. Approval belongs to a reviewed module/export pair, not a naming prefix or the caller's alias.

**Why:** A file-local AST cannot establish what an imported function returns. Recursively following application dependencies expands the policy into an incomplete whole-program analyzer; guessing from a helper name silently permits private Storage paths.

**How to apply:** Review the output contract before adding an imported builder to the allow-list. Distinguish ordinary safe metrics objects from sanitizers: permission to produce structured log fields must not imply permission to sanitize a private field or free-text message.

Keep callable provenance separate from ordinary data provenance. A conditional choice or `bind` around an imported function must lose approval, not lose its imported origin; treating every result of an imported function as a callable alias instead misclassifies normal data processing.

**Why:** Blanket rejection of all nested unknown calls also rejects numeric conversions, parsed string normalization, and arrays processed with approved sanitizers. A call's result and a reference to that call's implementation require different checks. At the structured-fields boundary itself, reject an unresolved call rather than assuming it is safe.