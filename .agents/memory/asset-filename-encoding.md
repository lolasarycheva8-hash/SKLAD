---
name: Asset filename encoding
description: Non-ASCII filenames can prevent downloadable asset registration.
---

Use ASCII filenames for files sent through presentAsset; keep localized wording in the title and description.

**Why:** Registering an XLSX with a Cyrillic filename failed with a ByteString conversion error. The identical bytes registered successfully after renaming the file to ASCII.

**How to apply:** For downloadable files, separate the user-facing localized title from the physical filename. This limitation does not imply that browser-generated Excel downloads require ASCII names.