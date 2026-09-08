import { eq } from "drizzle-orm";
import { db, productsTable } from "@workspace/db";

export function toProductDto(
  row: {
    id: string;
    name: string;
    sku: string;
    unit: string;
    purchasePrice: string;
    price: string;
    categoryId: string | null;
    minStock: string;
    supplier: string | null;
    supplierContact: string | null;
    createdAt: Date;
  },
  categoryName: string | null,
  currentStock: number,
) {
  const minStock = Number(row.minStock);
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    unit: row.unit,
    purchasePrice: Number(row.purchasePrice),
    price: Number(row.price),
    categoryId: row.categoryId,
    categoryName,
    currentStock,
    minStock,
    supplier: row.supplier,
    supplierContact: row.supplierContact,
    isLowStock: minStock > 0 && currentStock <= minStock * 0.6,
    createdAt: row.createdAt,
  };
}

export async function generateUniqueSku(baseSku: string): Promise<string> {
  let candidate = baseSku;
  let suffix = 2;
  for (;;) {
    const [existing] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(eq(productsTable.sku, candidate));
    if (!existing) return candidate;
    candidate = `${baseSku}-${suffix}`;
    suffix += 1;
  }
}
