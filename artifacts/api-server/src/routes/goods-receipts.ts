import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  productsTable,
  movementsTable,
  goodsReceiptsTable,
  goodsReceiptItemsTable,
} from "@workspace/db";
import {
  CreateGoodsReceiptBody,
  GetGoodsReceiptParams,
  UpdateGoodsReceiptParams,
  UpdateGoodsReceiptBody,
  DeleteGoodsReceiptParams,
  PostGoodsReceiptParams,
  ListGoodsReceiptsResponse,
  CreateGoodsReceiptResponse,
  GetGoodsReceiptResponse,
  UpdateGoodsReceiptResponse,
  PostGoodsReceiptResponse,
} from "@workspace/api-zod";
import { generateUniqueSku } from "../lib/products";
import { requirePermission, requireAdmin, requireSectionAccess } from "../middlewares/requirePermission";

const router: IRouter = Router();
router.use("/goods-receipts", requireSectionAccess("receipts"));
const canEditReceipts = requirePermission("receipts");

async function toGoodsReceiptDto(receipt: {
  id: string;
  docNumber: string;
  docType: string;
  totalSum: string;
  note: string | null;
  isPosted: boolean;
  createdAt: Date;
}) {
  const itemRows = await db
    .select({ item: goodsReceiptItemsTable, product: productsTable })
    .from(goodsReceiptItemsTable)
    .innerJoin(productsTable, eq(goodsReceiptItemsTable.productId, productsTable.id))
    .where(eq(goodsReceiptItemsTable.receiptId, receipt.id));

  const suppliers = [
    ...new Set(
      itemRows
        .map((row) => row.product.supplier?.trim())
        .filter((s): s is string => !!s),
    ),
  ].sort((a, b) => a.localeCompare(b, "ru"));

  return {
    id: receipt.id,
    docNumber: receipt.docNumber,
    docType: receipt.docType,
    totalSum: Number(receipt.totalSum),
    note: receipt.note,
    isPosted: receipt.isPosted,
    suppliers,
    items: itemRows.map((row) => ({
      id: row.item.id,
      productId: row.item.productId,
      productName: row.product.name,
      productUnit: row.product.unit,
      quantity: Number(row.item.quantity),
      price: Number(row.item.price),
      createdNewProductCard: false,
    })),
    createdAt: receipt.createdAt,
  };
}

router.get("/goods-receipts", async (_req, res): Promise<void> => {
  const rows = await db.select().from(goodsReceiptsTable).orderBy(desc(goodsReceiptsTable.createdAt));
  const dtos = await Promise.all(rows.map((row) => toGoodsReceiptDto(row)));
  res.json(ListGoodsReceiptsResponse.parse(dtos));
});

router.get("/goods-receipts/:id", async (req, res): Promise<void> => {
  const params = GetGoodsReceiptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [receipt] = await db
    .select()
    .from(goodsReceiptsTable)
    .where(eq(goodsReceiptsTable.id, params.data.id));
  if (!receipt) {
    res.status(404).json({ error: "Goods receipt not found" });
    return;
  }

  res.json(GetGoodsReceiptResponse.parse(await toGoodsReceiptDto(receipt)));
});

router.post("/goods-receipts", canEditReceipts, async (req, res): Promise<void> => {
  const parsed = CreateGoodsReceiptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const input = parsed.data;

  const receiptId = await db.transaction(async (tx) => {
    const [receipt] = await tx
      .insert(goodsReceiptsTable)
      .values({
        docNumber: input.docNumber,
        docType: input.docType,
        totalSum: String(input.totalSum),
        note: input.note ?? null,
      })
      .returning();

    for (const item of input.items) {
      let existing: typeof productsTable.$inferSelect | undefined;
      if (item.productId) {
        [existing] = await tx.select().from(productsTable).where(eq(productsTable.id, item.productId));
        if (!existing) {
          throw new Error(`Product not found: ${item.productId}`);
        }
      }

      let product: typeof productsTable.$inferSelect;

      if (existing && Number(existing.price) === item.price) {
        [product] = await tx
          .update(productsTable)
          .set({
            unit: item.unit,
            purchasePrice: String(item.purchasePrice ?? existing.purchasePrice),
            categoryId: item.categoryId !== undefined ? item.categoryId : existing.categoryId,
            minStock: item.minStock !== undefined ? String(item.minStock) : existing.minStock,
            supplier: item.supplier !== undefined ? item.supplier : existing.supplier,
            supplierContact:
              item.supplierContact !== undefined ? item.supplierContact : existing.supplierContact,
          })
          .where(eq(productsTable.id, existing.id))
          .returning();
      } else {
        const baseSku = item.sku || existing?.sku || item.name;
        const sku = await generateUniqueSku(baseSku);
        [product] = await tx
          .insert(productsTable)
          .values({
            name: item.name,
            sku,
            unit: item.unit,
            purchasePrice: String(item.purchasePrice ?? existing?.purchasePrice ?? 0),
            price: String(item.price),
            categoryId: (item.categoryId !== undefined ? item.categoryId : existing?.categoryId) ?? null,
            minStock: String(item.minStock ?? existing?.minStock ?? 0),
            supplier: (item.supplier !== undefined ? item.supplier : existing?.supplier) ?? null,
            supplierContact:
              (item.supplierContact !== undefined ? item.supplierContact : existing?.supplierContact) ??
              null,
          })
          .returning();
      }

      await tx.insert(goodsReceiptItemsTable).values({
        receiptId: receipt.id,
        productId: product.id,
        quantity: String(item.quantity),
        price: String(item.price),
      });

      await tx.insert(movementsTable).values({
        productId: product.id,
        type: "in",
        quantity: String(item.quantity),
        reason: `Поступление по документу №${input.docNumber}`,
        note: input.note ?? null,
        goodsReceiptId: receipt.id,
      });
    }

    return receipt.id;
  });

  const [receipt] = await db.select().from(goodsReceiptsTable).where(eq(goodsReceiptsTable.id, receiptId));

  res.status(201).json(CreateGoodsReceiptResponse.parse(await toGoodsReceiptDto(receipt)));
});

router.patch("/goods-receipts/:id", canEditReceipts, async (req, res): Promise<void> => {
  const params = UpdateGoodsReceiptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateGoodsReceiptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [receipt] = await db
    .select()
    .from(goodsReceiptsTable)
    .where(eq(goodsReceiptsTable.id, params.data.id));
  if (!receipt) {
    res.status(404).json({ error: "Goods receipt not found" });
    return;
  }
  if (receipt.isPosted) {
    res.status(400).json({ error: "Документ проведён — редактирование запрещено" });
    return;
  }

  const input = parsed.data;

  if (input.items) {
    if (input.items.length === 0) {
      res.status(400).json({ error: "Документ должен содержать хотя бы одну позицию" });
      return;
    }
    const ids = input.items.map((i) => i.id);
    if (new Set(ids).size !== ids.length) {
      res.status(400).json({ error: "Позиции документа не должны повторяться" });
      return;
    }
    const existing = await db
      .select({ id: goodsReceiptItemsTable.id })
      .from(goodsReceiptItemsTable)
      .where(eq(goodsReceiptItemsTable.receiptId, receipt.id));
    const existingIds = new Set(existing.map((i) => i.id));
    for (const id of ids) {
      if (!existingIds.has(id)) {
        res.status(400).json({ error: "Позиция не найдена в документе" });
        return;
      }
    }
  }

  await db.transaction(async (tx) => {
    const existingItems = await tx
      .select()
      .from(goodsReceiptItemsTable)
      .where(eq(goodsReceiptItemsTable.receiptId, receipt.id));

    let totalSum = Number(receipt.totalSum);
    let finalItems = existingItems;

    if (input.items) {
      const byId = new Map(existingItems.map((i) => [i.id, i]));

      const keepIds = new Set(input.items.map((i) => i.id));
      for (const existing of existingItems) {
        if (!keepIds.has(existing.id)) {
          await tx.delete(goodsReceiptItemsTable).where(eq(goodsReceiptItemsTable.id, existing.id));
        }
      }
      for (const item of input.items) {
        await tx
          .update(goodsReceiptItemsTable)
          .set({ quantity: String(item.quantity) })
          .where(eq(goodsReceiptItemsTable.id, item.id));
      }

      finalItems = input.items.map((i) => {
        const existing = byId.get(i.id)!;
        return { ...existing, quantity: String(i.quantity) };
      });
      totalSum = finalItems.reduce((sum, i) => sum + Number(i.quantity) * Number(i.price), 0);

      // Rebuild the movement ledger rows for this receipt to match the new items
      await tx.delete(movementsTable).where(eq(movementsTable.goodsReceiptId, receipt.id));
      for (const item of finalItems) {
        await tx.insert(movementsTable).values({
          productId: item.productId,
          type: "in",
          quantity: item.quantity,
          reason: `Поступление по документу №${input.docNumber ?? receipt.docNumber}`,
          note: input.note !== undefined ? input.note : receipt.note,
          goodsReceiptId: receipt.id,
        });
      }
    }

    await tx
      .update(goodsReceiptsTable)
      .set({
        docNumber: input.docNumber ?? receipt.docNumber,
        docType: input.docType ?? receipt.docType,
        note: input.note !== undefined ? input.note : receipt.note,
        totalSum: String(totalSum),
      })
      .where(eq(goodsReceiptsTable.id, receipt.id));
  });

  const [updated] = await db
    .select()
    .from(goodsReceiptsTable)
    .where(eq(goodsReceiptsTable.id, receipt.id));

  res.json(UpdateGoodsReceiptResponse.parse(await toGoodsReceiptDto(updated)));
});

router.post("/goods-receipts/:id/post", canEditReceipts, async (req, res): Promise<void> => {
  const params = PostGoodsReceiptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [receipt] = await db
    .select()
    .from(goodsReceiptsTable)
    .where(eq(goodsReceiptsTable.id, params.data.id));
  if (!receipt) {
    res.status(404).json({ error: "Goods receipt not found" });
    return;
  }

  if (!receipt.isPosted) {
    await db
      .update(goodsReceiptsTable)
      .set({ isPosted: true })
      .where(eq(goodsReceiptsTable.id, receipt.id));
  }

  const [updated] = await db
    .select()
    .from(goodsReceiptsTable)
    .where(eq(goodsReceiptsTable.id, receipt.id));

  res.json(PostGoodsReceiptResponse.parse(await toGoodsReceiptDto(updated)));
});

router.delete("/goods-receipts/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteGoodsReceiptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [receipt] = await db
    .select()
    .from(goodsReceiptsTable)
    .where(eq(goodsReceiptsTable.id, params.data.id));
  if (!receipt) {
    res.status(404).json({ error: "Goods receipt not found" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(movementsTable).where(eq(movementsTable.goodsReceiptId, receipt.id));
    await tx.delete(goodsReceiptsTable).where(eq(goodsReceiptsTable.id, receipt.id));
  });

  res.status(204).end();
});

export default router;
