---
name: OpenAPI regex escaping
description: How YAML backslash escaping affects Orval-generated Zod regular expressions
---

In single-quoted OpenAPI YAML patterns, use one backslash for regex tokens such as `\d`; do not write `\\d`.

**Why:** YAML single-quoted scalars preserve backslashes literally. Doubling them makes Orval generate a JavaScript regular expression that matches a backslash plus `d`, so valid date query parameters are rejected at runtime even though the pattern looks plausible in generated comments.

**How to apply:** After changing a patterned query parameter, regenerate the clients and add a route-level test that submits a real valid value through the generated Zod parser.