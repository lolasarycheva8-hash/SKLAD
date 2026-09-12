---
name: Delivery form field ownership
description: Why delivery entry displays shared site data but edits delivery-specific choices.
---

Keep address, branch, features, and manager tied to the selected object and read-only in the delivery form. Changing a delivery's driver, dates, or selected supply type must not update the shared object.

**Why:** The user chose automatic object-field population but explicitly requested editable driver, dates, and supply type. Editing a shared object from this form would unexpectedly change other deliveries.

**How to apply:** Store differing supply types as a per-delivery override and retain object inheritance when no override is selected. Keep operational delivery lookups available under delivery-section permissions; creating a delivery must not require access to editing objects.