import { Router, type IRouter } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  inventoryItemsTable,
  inventoryRequestsTable,
  inventoryRequestItemsTable,
  sitesTable,
  type InventoryRequest,
  type InventoryRequestItem,
} from "@workspace/db";
import {
  ListInventoryItemsResponse,
  CreateInventoryItemBody,
  CreateInventoryItemResponse,
  UpdateInventoryItemParams,
  UpdateInventoryItemBody,
  UpdateInventoryItemResponse,
  DeleteInventoryItemParams,
  ListInventoryRequestsQueryParams,
  ListInventoryRequestsResponse,
  CreateInventoryRequestBody,
  CreateInventoryRequestResponse,
  ApproveInventoryRequestParams,
  ApproveInventoryRequestBody,
  ApproveInventoryRequestResponse,
  RejectInventoryRequestParams,
  RejectInventoryRequestBody,
  RejectInventoryRequestResponse,
  MarkInventoryRequestDoneParams,
  MarkInventoryRequestDoneResponse,
} from "@workspace/api-zod";
import { requirePermission, requireSectionAccess } from "../middlewares/requirePermission";

const router: IRouter = Router();
router.use("/inventory-items", requireSectionAccess("inventory"));
router.use("/inventory-requests", requireSectionAccess("inventory"));
const canEditInventory = requirePermission("inventory");

function actorName(req: { appUser?: { name: string | null; email: string } | null }): string {
  return req.appUser?.name ?? req.appUser?.email ?? "неизвестно";
}

function toRequestDto(
  row: InventoryRequest,
  siteName: string | null,
  items: InventoryRequestItem[],
) {
  return {
    id: row.id,
    siteId: row.siteId,
    siteName,
    status: row.status,
    note: row.note,
    createdBy: row.createdBy,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    doneBy: row.doneBy,
    doneAt: row.doneAt,
    items: items.map((i) => ({
      id: i.id,
      itemId: i.itemId,
      name: i.name,
      unit: i.unit,
      qty: Number(i.qty),
    })),
    createdAt: row.createdAt,
  };
}

async function loadRequestDto(id: string) {
  const [row] = await db
    .select({ request: inventoryRequestsTable, siteName: sitesTable.name })
    .from(inventoryRequestsTable)
    .leftJoin(sitesTable, eq(inventoryRequestsTable.siteId, sitesTable.id))
    .where(eq(inventoryRequestsTable.id, id));
  if (!row) return null;
  const items = await db
    .select()
    .from(inventoryRequestItemsTable)
    .where(eq(inventoryRequestItemsTable.requestId, id));
  return toRequestDto(row.request, row.siteName, items);
}

// --- Справочник инвентаря ---

router.get("/inventory-items", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(inventoryItemsTable)
    .orderBy(asc(inventoryItemsTable.sort), asc(inventoryItemsTable.name));
  res.json(ListInventoryItemsResponse.parse(rows));
});

router.post("/inventory-items", canEditInventory, async (req, res): Promise<void> => {
  const parsed = CreateInventoryItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.name, parsed.data.name));
  if (existing) {
    res.status(409).json({ error: "Позиция с таким названием уже существует" });
    return;
  }

  const [item] = await db
    .insert(inventoryItemsTable)
    .values({
      name: parsed.data.name,
      unit: parsed.data.unit,
      category: parsed.data.category ?? null,
      sort: parsed.data.sort ?? 0,
    })
    .returning();
  res.status(201).json(CreateInventoryItemResponse.parse(item));
});

router.patch("/inventory-items/:id", canEditInventory, async (req, res): Promise<void> => {
  const params = UpdateInventoryItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateInventoryItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateValues: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateValues.name = parsed.data.name;
  if (parsed.data.unit !== undefined) updateValues.unit = parsed.data.unit;
  if (parsed.data.category !== undefined) updateValues.category = parsed.data.category;
  if (parsed.data.sort !== undefined) updateValues.sort = parsed.data.sort;
  if (parsed.data.active !== undefined) updateValues.active = parsed.data.active;

  const [item] = await db
    .update(inventoryItemsTable)
    .set(updateValues)
    .where(eq(inventoryItemsTable.id, params.data.id))
    .returning();
  if (!item) {
    res.status(404).json({ error: "Позиция не найдена" });
    return;
  }
  res.json(UpdateInventoryItemResponse.parse(item));
});

router.delete("/inventory-items/:id", canEditInventory, async (req, res): Promise<void> => {
  const params = DeleteInventoryItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [item] = await db
    .delete(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, params.data.id))
    .returning();
  if (!item) {
    res.status(404).json({ error: "Позиция не найдена" });
    return;
  }
  res.sendStatus(204);
});

// --- Заявки на инвентарь ---

router.get("/inventory-requests", async (req, res): Promise<void> => {
  const query = ListInventoryRequestsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const conditions = [];
  if (query.data.status) conditions.push(eq(inventoryRequestsTable.status, query.data.status));
  if (query.data.siteId) conditions.push(eq(inventoryRequestsTable.siteId, query.data.siteId));

  const rows = await db
    .select({ request: inventoryRequestsTable, siteName: sitesTable.name })
    .from(inventoryRequestsTable)
    .leftJoin(sitesTable, eq(inventoryRequestsTable.siteId, sitesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(inventoryRequestsTable.createdAt);

  const ids = rows.map((r) => r.request.id);
  const allItems =
    ids.length > 0
      ? await db
          .select()
          .from(inventoryRequestItemsTable)
          .where(inArray(inventoryRequestItemsTable.requestId, ids))
      : [];
  const itemsByRequest = new Map<string, InventoryRequestItem[]>();
  for (const item of allItems) {
    const list = itemsByRequest.get(item.requestId) ?? [];
    list.push(item);
    itemsByRequest.set(item.requestId, list);
  }

  res.json(
    ListInventoryRequestsResponse.parse(
      rows
        .map((r) => toRequestDto(r.request, r.siteName, itemsByRequest.get(r.request.id) ?? []))
        .reverse(),
    ),
  );
});

router.post("/inventory-requests", canEditInventory, async (req, res): Promise<void> => {
  const parsed = CreateInventoryRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const itemIds = parsed.data.items.map((i) => i.itemId);
  const catalogItems = await db
    .select()
    .from(inventoryItemsTable)
    .where(inArray(inventoryItemsTable.id, itemIds));
  const catalogMap = new Map(catalogItems.map((i) => [i.id, i]));
  const missing = itemIds.filter((id) => !catalogMap.has(id));
  if (missing.length > 0) {
    res.status(400).json({ error: "Некоторые позиции не найдены в справочнике" });
    return;
  }

  if (parsed.data.siteId) {
    const [site] = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.id, parsed.data.siteId));
    if (!site) {
      res.status(404).json({ error: "Объект не найден" });
      return;
    }
  }

  const dto = await db.transaction(async (tx) => {
    const [request] = await tx
      .insert(inventoryRequestsTable)
      .values({
        siteId: parsed.data.siteId ?? null,
        note: parsed.data.note ?? null,
        createdBy: actorName(req),
        createdByUserId: req.appUser?.id ?? null,
      })
      .returning();

    const items = await tx
      .insert(inventoryRequestItemsTable)
      .values(
        parsed.data.items.map((i) => {
          const catalog = catalogMap.get(i.itemId)!;
          return {
            requestId: request.id,
            itemId: i.itemId,
            name: catalog.name,
            unit: catalog.unit,
            qty: String(i.qty),
          };
        }),
      )
      .returning();
    return { request, items };
  });

  let siteName: string | null = null;
  if (dto.request.siteId) {
    const [site] = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.id, dto.request.siteId));
    siteName = site?.name ?? null;
  }

  res
    .status(201)
    .json(CreateInventoryRequestResponse.parse(toRequestDto(dto.request, siteName, dto.items)));
});

router.post(
  "/inventory-requests/:id/approve",
  canEditInventory,
  async (req, res): Promise<void> => {
    const params = ApproveInventoryRequestParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = ApproveInventoryRequestBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // Atomic transition: only a still-new request can be approved.
    const [updated] = await db
      .update(inventoryRequestsTable)
      .set({
        status: "approved",
        decidedBy: actorName(req),
        decidedAt: new Date(),
        decisionNote: parsed.data.note ?? null,
      })
      .where(
        and(eq(inventoryRequestsTable.id, params.data.id), eq(inventoryRequestsTable.status, "new")),
      )
      .returning();
    if (!updated) {
      const [existing] = await db
        .select()
        .from(inventoryRequestsTable)
        .where(eq(inventoryRequestsTable.id, params.data.id));
      res
        .status(existing ? 409 : 404)
        .json({ error: existing ? "Решение по заявке уже принято" : "Заявка не найдена" });
      return;
    }

    res.json(ApproveInventoryRequestResponse.parse(await loadRequestDto(params.data.id)));
  },
);

router.post(
  "/inventory-requests/:id/reject",
  canEditInventory,
  async (req, res): Promise<void> => {
    const params = RejectInventoryRequestParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = RejectInventoryRequestBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [updated] = await db
      .update(inventoryRequestsTable)
      .set({
        status: "rejected",
        decidedBy: actorName(req),
        decidedAt: new Date(),
        decisionNote: parsed.data.note ?? null,
      })
      .where(
        and(eq(inventoryRequestsTable.id, params.data.id), eq(inventoryRequestsTable.status, "new")),
      )
      .returning();
    if (!updated) {
      const [existing] = await db
        .select()
        .from(inventoryRequestsTable)
        .where(eq(inventoryRequestsTable.id, params.data.id));
      res
        .status(existing ? 409 : 404)
        .json({ error: existing ? "Решение по заявке уже принято" : "Заявка не найдена" });
      return;
    }

    res.json(RejectInventoryRequestResponse.parse(await loadRequestDto(params.data.id)));
  },
);

router.post(
  "/inventory-requests/:id/done",
  canEditInventory,
  async (req, res): Promise<void> => {
    const params = MarkInventoryRequestDoneParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [updated] = await db
      .update(inventoryRequestsTable)
      .set({ status: "done", doneBy: actorName(req), doneAt: new Date() })
      .where(
        and(
          eq(inventoryRequestsTable.id, params.data.id),
          eq(inventoryRequestsTable.status, "approved"),
        ),
      )
      .returning();
    if (!updated) {
      const [existing] = await db
        .select()
        .from(inventoryRequestsTable)
        .where(eq(inventoryRequestsTable.id, params.data.id));
      res
        .status(existing ? 409 : 404)
        .json({ error: existing ? "Выдать можно только одобренную заявку" : "Заявка не найдена" });
      return;
    }

    res.json(MarkInventoryRequestDoneResponse.parse(await loadRequestDto(params.data.id)));
  },
);

export default router;
