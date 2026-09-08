import { Router, type IRouter } from "express";
import { and, eq, ilike } from "drizzle-orm";
import { db, categoriesTable, productsTable, movementsTable } from "@workspace/db";
import {
  CreateProductBody,
  UpdateProductBody,
  GetProductParams,
  UpdateProductParams,
  DeleteProductParams,
  ListProductsQueryParams,
  ListProductsResponse,
  CreateProductResponse,
  GetProductResponse,
  UpdateProductResponse,
  CreateProductsBulkBody,
  CreateProductsBulkResponse,
} from "@workspace/api-zod";
import { getCurrentStockForProduct, getCurrentStockMap } from "../lib/stock";
import { toProductDto } from "../lib/products";
import { requirePermission, requireSectionAccess } from "../middlewares/requirePermission";

const router: IRouter = Router();
router.use("/products", requireSectionAccess("products"));
const canEditProducts = requirePermission("products");

router.get("/products", async (req, res): Promise<void> => {
  const query = ListProductsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { search, categoryId } = query.data;

  const conditions = [];
  if (search) {
    conditions.push(ilike(productsTable.name, `%${search}%`));
  }
  if (categoryId) {
    conditions.push(eq(productsTable.categoryId, categoryId));
  }

  const rows = await db
    .select({
      product: productsTable,
      categoryName: categoriesTable.name,
    })
    .from(productsTable)
    .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(productsTable.name);

  const stockMap = await getCurrentStockMap();

  let dtos = rows.map((row) =>
    toProductDto(row.product, row.categoryName, stockMap.get(row.product.id) ?? 0),
  );

  if (query.data.lowStockOnly) {
    dtos = dtos.filter((p) => p.isLowStock);
  }

  res.json(ListProductsResponse.parse(dtos));
});

router.post("/products", canEditProducts, async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { initialStock, ...productInput } = parsed.data;

  const [product] = await db
    .insert(productsTable)
    .values({
      name: productInput.name,
      sku: productInput.sku,
      unit: productInput.unit,
      purchasePrice: String(productInput.purchasePrice ?? 0),
      price: String(productInput.price),
      categoryId: productInput.categoryId ?? null,
      minStock: String(productInput.minStock ?? 0),
      supplier: productInput.supplier ?? null,
      supplierContact: productInput.supplierContact ?? null,
    })
    .returning();

  if (initialStock && initialStock > 0) {
    await db.insert(movementsTable).values({
      productId: product.id,
      type: "in",
      quantity: String(initialStock),
      reason: "Начальный остаток",
    });
  }

  let categoryName: string | null = null;
  if (product.categoryId) {
    const [category] = await db
      .select()
      .from(categoriesTable)
      .where(eq(categoriesTable.id, product.categoryId));
    categoryName = category?.name ?? null;
  }

  const currentStock = await getCurrentStockForProduct(product.id);

  res.status(201).json(CreateProductResponse.parse(toProductDto(product, categoryName, currentStock)));
});

router.post("/products/bulk", canEditProducts, async (req, res): Promise<void> => {
  const parsed = CreateProductsBulkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const results: Awaited<ReturnType<typeof toProductDto>>[] = [];

  for (const item of parsed.data.items) {
    const [existing] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.sku, item.sku));

    let product;
    if (existing) {
      [product] = await db
        .update(productsTable)
        .set({
          name: item.name,
          unit: item.unit,
          purchasePrice: String(item.purchasePrice ?? existing.purchasePrice),
          price: String(item.price),
          categoryId: item.categoryId ?? existing.categoryId,
          minStock: String(item.minStock ?? existing.minStock),
          supplier: item.supplier ?? existing.supplier,
          supplierContact: item.supplierContact ?? existing.supplierContact,
        })
        .where(eq(productsTable.id, existing.id))
        .returning();
    } else {
      [product] = await db
        .insert(productsTable)
        .values({
          name: item.name,
          sku: item.sku,
          unit: item.unit,
          purchasePrice: String(item.purchasePrice ?? 0),
          price: String(item.price),
          categoryId: item.categoryId ?? null,
          minStock: String(item.minStock ?? 0),
          supplier: item.supplier ?? null,
          supplierContact: item.supplierContact ?? null,
        })
        .returning();

      if (item.initialStock && item.initialStock > 0) {
        await db.insert(movementsTable).values({
          productId: product.id,
          type: "in",
          quantity: String(item.initialStock),
          reason: "Начальный остаток (импорт)",
        });
      }
    }

    let categoryName: string | null = null;
    if (product.categoryId) {
      const [category] = await db
        .select()
        .from(categoriesTable)
        .where(eq(categoriesTable.id, product.categoryId));
      categoryName = category?.name ?? null;
    }

    const currentStock = await getCurrentStockForProduct(product.id);
    results.push(toProductDto(product, categoryName, currentStock));
  }

  res.status(201).json(CreateProductsBulkResponse.parse(results));
});

router.get("/products/:id", async (req, res): Promise<void> => {
  const params = GetProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db
    .select({
      product: productsTable,
      categoryName: categoriesTable.name,
    })
    .from(productsTable)
    .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
    .where(eq(productsTable.id, params.data.id));

  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const currentStock = await getCurrentStockForProduct(row.product.id);

  res.json(GetProductResponse.parse(toProductDto(row.product, row.categoryName, currentStock)));
});

router.patch("/products/:id", canEditProducts, async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateValues: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateValues.name = parsed.data.name;
  if (parsed.data.sku !== undefined) updateValues.sku = parsed.data.sku;
  if (parsed.data.unit !== undefined) updateValues.unit = parsed.data.unit;
  if (parsed.data.purchasePrice !== undefined)
    updateValues.purchasePrice = String(parsed.data.purchasePrice);
  if (parsed.data.price !== undefined) updateValues.price = String(parsed.data.price);
  if (parsed.data.categoryId !== undefined) updateValues.categoryId = parsed.data.categoryId;
  if (parsed.data.minStock !== undefined) updateValues.minStock = String(parsed.data.minStock);
  if (parsed.data.supplier !== undefined) updateValues.supplier = parsed.data.supplier;
  if (parsed.data.supplierContact !== undefined)
    updateValues.supplierContact = parsed.data.supplierContact;

  const [product] = await db
    .update(productsTable)
    .set(updateValues)
    .where(eq(productsTable.id, params.data.id))
    .returning();

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  let categoryName: string | null = null;
  if (product.categoryId) {
    const [category] = await db
      .select()
      .from(categoriesTable)
      .where(eq(categoriesTable.id, product.categoryId));
    categoryName = category?.name ?? null;
  }

  const currentStock = await getCurrentStockForProduct(product.id);

  res.json(UpdateProductResponse.parse(toProductDto(product, categoryName, currentStock)));
});

router.delete("/products/:id", canEditProducts, async (req, res): Promise<void> => {
  const params = DeleteProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [product] = await db
    .delete(productsTable)
    .where(eq(productsTable.id, params.data.id))
    .returning();

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
