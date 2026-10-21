---

Standard types «закрытие», «открывашка», «отмывка» skip product selection. Driver badges must read «Вывоз», «Открывашка», «Отмывка», not «Доп.заказ».

The yellow additional-delivery badge in Logistics and driver views must use the selected delivery type for all types, not only the standard services; «закрытие» displays as «Вывоз».

**Why:** The user requested that the highlighted «Доп.заказ» badge identify the actual kind of additional delivery.

**Why:** The user identified these as standard operations/sets, not individually selected merchandise (noting uncertainty about future use of отмывка).

**How to apply:** Do not invent product contents or quantities for these types. Keep ordinary additional orders' required product selection.
name: Additional delivery orders
description: Product rules for supplementary client orders linked to a primary delivery.
---

An additional order is a new client order plus a separate delivery. When created from an existing delivery, link it to that source; standalone orders must not require a placeholder primary delivery. Save the order and delivery atomically after the goods form is complete. The chosen delivery type may match the source type.

**Why:** The user clarified that supplementary-only shops (for example the Верный network) do not receive monthly boxes. Requiring a different type or a placeholder box creates a false second stop in the driver's route.

**How to apply:** Separate site service mode (monthly supply versus supplementary orders) from the type of each actual delivery. Both site modes allow supplementary orders. Preserve historical deliveries and acts when changing a site's mode; show each actual delivery's chosen type to its driver.

The “ДОП.ЗАКАЗ” badge belongs only to the additional delivery, never the primary delivery that has additional orders.

**Why:** The user explicitly rejected marking both deliveries: having an additional order does not make the primary delivery an additional order.

**How to apply:** Apply this distinction to driver cards, logistics tables and grouped schedule displays; do not use the existence of child orders as a delivery-type label.

**Why:** The user requested creating additional orders from Logistics while keeping them visible in Client Orders and independently executable in the delivery schedule.

**How to apply:** Copy planning and assignment data, not completion, approval, driver comments, or acts. Keep primary and additional delivery completion independent. Show “ДОП.ЗАКАЗ” and product quantities to logistics and to the driver assigned to the additional delivery; do not expose a reassigned child’s contents through its parent. Preserve additional orders during ordinary monthly schedule replacement. Keep ordinary schedule duplicate protections rather than permitting arbitrary duplicate primary deliveries.

An order's legal entity and concrete shop are separate identities. “Магазин” means the specific location with its address, not a trade network. Preserve the destination as selected rather than silently changing historical orders after a location rename or deletion; legacy orders without a shop remain valid.

**Why:** The user prepares future orders and needs to distinguish shops belonging to the same legal entity.

**How to apply:** Show both shop and address alongside the legal entity, retain this distinction when copying/editing/printing, and never silently move a delivery-linked order to another location independently of its delivery.

Start standalone order entry with a shop search, deriving the legal entity from the chosen shop rather than requiring users to know it first.

**Why:** The user identifies destinations by shop name and address and explicitly requested automatic legal-entity selection.

**How to apply:** Search across shops, not only those of a preselected client; retain explicit manual client selection for orders without a shop.

New orders created in «Заказы клиентов», including copies from the list or detail card, must request a delivery date and create a separate linked delivery atomically. A concrete shop is required; the plan month follows the selected date. Do not infer dates for existing undelivered orders.

**Why:** The user explicitly requested that all orders created in the Orders section ask for a delivery date and then appear in the delivery schedule.

**How to apply:** Keep existing orders unchanged unless the user supplies their dates. New copies request their own date and never reuse completion data from the source.

The planning month is mandatory for new orders and copies; a saved month must not be cleared.

**Why:** The user explicitly requested mandatory month entry in the order card. Historical orders without a month should not receive an invented business date.

**How to apply:** Require a selected month on creation/copy and when editing the month, while retaining historical missing-month visibility. Delivery-linked orders keep their delivery-derived month.