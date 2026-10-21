import { and, eq, sql } from "drizzle-orm";
import { db, productsTable, movementsTable, categoriesTable } from "@workspace/db";
import { CreateProductsBulkBody, CreateProductsBulkResponse } from "@workspace/api-zod";
import { toProductDto } from "./products";

export class ProductImportError extends Error {
  constructor(message: string, public status: number = 400) {
    super(message);
  }
}

type Input = typeof CreateProductsBulkBody._output;

export async function importProducts(input: Input) {
  const seen = new Map<string, number>();
  const items = input.items.map((item, index) => {
    const name = item.name.trim();
    const sku = item.sku.trim();
    const row = index + 2;
    if (!name) throw new ProductImportError(`Строка ${row}: заполните название товара. Ничего не сохранено.`);
    const key = sku ? `sku:${sku}` : `name:${name.toLowerCase()}`;
    const previousRow = seen.get(key);
    if (previousRow !== undefined) {
      throw new ProductImportError(
        `Строки ${previousRow} и ${row}: повторяется ${sku ? `артикул «${sku}»` : `название «${name}» без артикула`}. Укажите разные артикулы или удалите повторную строку. Ничего не сохранено.`,
      );
    }
    seen.set(key, row);
    return { ...item, name, sku, row };
  });

  return db.transaction(async (tx) => {
    // Also excludes ordinary product INSERT/UPDATE/DELETE while identities are
    // resolved: advisory locks alone would not protect those other write paths.
    await tx.execute(sql`LOCK TABLE products IN SHARE ROW EXCLUSIVE MODE`);
    const products = [];
    const resolvedRows = new Map<string, number>();
    let created = 0;
    let updated = 0;
    for (const item of items) {
      const matches = await tx.select().from(productsTable).where(
        item.sku
          ? sql`btrim(${productsTable.sku}) = ${item.sku}`
          : and(
            sql`btrim(${productsTable.sku}) = ''`,
            sql`lower(btrim(${productsTable.name})) = lower(${item.name})`,
          ),
      );
      if (matches.length > 1) {
        throw new ProductImportError(
          `Строка ${item.row}: найдено несколько товаров с ${item.sku ? `артикулом «${item.sku}»` : `названием «${item.name}» без артикула`}. Уточните артикулы в справочнике и файле. Ничего не сохранено.`,
          409,
        );
      }
      const existing = matches[0];
      if (existing && resolvedRows.has(existing.id)) {
        throw new ProductImportError(
          `Строки ${resolvedRows.get(existing.id)} и ${item.row}: названия или артикулы соответствуют одному товару. Укажите разные артикулы или удалите повторную строку. Ничего не сохранено.`,
        );
      }
      const values = {
        name: item.name,
        sku: item.sku,
        unit: item.unit,
        purchasePrice: String(item.purchasePrice ?? existing?.purchasePrice ?? 0),
        price: String(item.price),
        categoryId: item.categoryId ?? existing?.categoryId ?? null,
        minStock: String(item.minStock ?? existing?.minStock ?? 0),
        supplier: item.supplier ?? existing?.supplier ?? null,
        supplierContact: item.supplierContact ?? existing?.supplierContact ?? null,
      };
      const [product] = existing
        ? await tx.update(productsTable).set(values).where(eq(productsTable.id, existing.id)).returning()
        : await tx.insert(productsTable).values(values).returning();
      resolvedRows.set(product.id, item.row);
      if (existing) updated++;
      else {
        created++;
        if (item.initialStock && item.initialStock > 0) {
          await tx.insert(movementsTable).values({
            productId: product.id,
            type: "in",
            quantity: String(item.initialStock),
            reason: "Начальный остаток (импорт)",
          });
        }
      }
      const [category] = product.categoryId
        ? await tx.select().from(categoriesTable).where(eq(categoriesTable.id, product.categoryId))
        : [];
      const [stock] = await tx.select({
        total: sql<string>`coalesce(sum(case when ${movementsTable.type} = 'in' then ${movementsTable.quantity} else -${movementsTable.quantity} end), 0)`,
      }).from(movementsTable).where(eq(movementsTable.productId, product.id));
      products.push(toProductDto(product, category?.name ?? null, Number(stock.total)));
    }
    // Validate before COMMIT so a malformed response cannot leave a saved batch.
    return CreateProductsBulkResponse.parse({ products, created, updated });
  });
}