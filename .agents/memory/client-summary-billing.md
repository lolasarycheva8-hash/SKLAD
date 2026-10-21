---
name: Client summary billing workflow
description: User-defined order lifecycle, delivery evidence and consolidated client payment control.
---

Orders use five statuses: «Черновик», «Отгружен», «Доставлен», «Ожидает оплаты», «Оплачен». Order delivery requires completion in the delivery schedule plus an uploaded act, not logistician approval of that act.

**Why:** The user explicitly requested post-delivery billing and these five statuses. This does not change the separate delivery «Закрыто» approval workflow.

**How to apply:** Keep order billing status distinct from delivery approval. Work orders include delivered orders until billing; expose waiting and paid orders separately.

The client receives a consolidated order for payment. Keep a persistent list of consolidated orders to track payment. Forming one changes its source orders to «Ожидает оплаты»; manually marking it «Оплачен» marks every included order paid.

**Why:** The user explicitly confirmed the transition on summary formation and specified payment propagation to all source orders.

**How to apply:** Do not duplicate source operational orders or stock movements. Block summary creation if any order in the requested client/period is not delivered, and list those order numbers explicitly with a request to complete them first. Do not silently leave unfinished orders out.