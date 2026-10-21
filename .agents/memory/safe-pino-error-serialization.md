---
name: Safe Pino error serialization
description: Non-obvious privacy and fidelity behavior of Pino's standard Error serializer.
---

Pino's standard Error serializer folds a cause message into the parent message instead of retaining a separately queryable cause object, copies enumerable custom Error fields, and may recursively follow cyclic causes before an outer guard can intervene. Do not invoke it for these structured cleanup errors. Serialize an explicit allow-list, share repeated-Error detection across nested fields, and cap nesting depth.

**Why:** Structured cleanup errors need both failure reasons visible to operators, while status and storage metadata such as object paths must not leak into JSON logs.

Normalized paths below `/objects/uploads/` and physical paths below the configured private object directory's `uploads/` prefix are private even when a provider embeds them inside `message` or `stack`. The same rule applies when a known prefix uses percent-encoded path separators. Preserve the failure explanation and stable path category, but replace the complete object name and physical prefix.

**How to apply:** Whenever an Error gains custom fields or nested causes intended for logs, verify it through the real logger configuration and assert root-message preservation, cycle/depth termination, text-path sanitization, and absence of private enumerable fields. Match encoded forms only against known private prefixes; never URL-decode arbitrary log text.

Automatic HTTP request logs need the same protection: Express can route a percent-encoded private path after decoding characters that remain encoded in the raw URL logged by Pino. For request URL paths only, tolerate malformed escapes while decoding valid percent triplets for known-prefix detection, then consume the complete private suffix even if it decodes to CR/LF. Verify the actual `pino-http` JSON rather than testing only the sanitizer function.