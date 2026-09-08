import { sql } from "drizzle-orm";
import { db, movementsTable } from "@workspace/db";

export async function getCurrentStockMap(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      productId: movementsTable.productId,
      total: sql<string>`sum(case when ${movementsTable.type} = 'in' then ${movementsTable.quantity} else -${movementsTable.quantity} end)`,
    })
    .from(movementsTable)
    .groupBy(movementsTable.productId);

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.productId, Number(row.total));
  }
  return map;
}

export async function getCurrentStockForProduct(productId: string): Promise<number> {
  const rows = await db
    .select({
      total: sql<string>`sum(case when ${movementsTable.type} = 'in' then ${movementsTable.quantity} else -${movementsTable.quantity} end)`,
    })
    .from(movementsTable)
    .where(sql`${movementsTable.productId} = ${productId}`);

  return Number(rows[0]?.total ?? 0);
}
