import { and, eq, ne } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import {
  db,
  deliveriesTable,
  ordersTable,
} from "@workspace/db";

type DbOrTx = typeof db | PgTransaction<any, any, any>;

export const SITE_CLIENT_ORDER_MISMATCH_ERROR =
  "Нельзя изменить клиента объекта: он не совпадает с клиентом связанного заказа";

/**
 * Check the client invariant while the caller holds its site/client mutation
 * locks. The joined rows are locked as well so a site update, import, and
 * approved change request all make the same decision in their transaction.
 */
export async function hasLinkedOrderForDifferentClient(
  database: DbOrTx,
  siteId: string,
  clientId: string,
): Promise<boolean> {
  const [linkedOrder] = await database
    .select({ deliveryId: deliveriesTable.id })
    .from(deliveriesTable)
    .innerJoin(ordersTable, eq(deliveriesTable.orderId, ordersTable.id))
    .where(
      and(
        eq(deliveriesTable.siteId, siteId),
        ne(ordersTable.clientId, clientId),
      ),
    )
    .for("update")
    .limit(1);
  return linkedOrder !== undefined;
}