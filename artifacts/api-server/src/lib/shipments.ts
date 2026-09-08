import { eq } from "drizzle-orm";
import {
  db,
  shipmentItemsTable,
  productsTable,
  sitesTable,
  clientsTable,
  ordersTable,
  orderItemsTable,
  appUsersTable,
} from "@workspace/db";

export async function toShipmentDto(shipment: {
  id: string;
  orderId: string;
  siteId: string;
  driverUserId: string | null;
  shipmentDate: string;
  note: string | null;
  isDispatched: boolean;
  dispatchedAt: Date | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  deleteNote: string | null;
  createdAt: Date;
}) {
  const [orderRow] = await db
    .select({ clientName: clientsTable.name })
    .from(ordersTable)
    .innerJoin(clientsTable, eq(ordersTable.clientId, clientsTable.id))
    .where(eq(ordersTable.id, shipment.orderId));

  const orderNumber = shipment.orderId.slice(0, 8);

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, shipment.siteId));
  const [driverUser] = shipment.driverUserId
    ? await db
        .select({ name: appUsersTable.name, email: appUsersTable.email })
        .from(appUsersTable)
        .where(eq(appUsersTable.id, shipment.driverUserId))
    : [];

  const itemRows = await db
    .select({ item: shipmentItemsTable, product: productsTable })
    .from(shipmentItemsTable)
    .innerJoin(productsTable, eq(shipmentItemsTable.productId, productsTable.id))
    .where(eq(shipmentItemsTable.shipmentId, shipment.id));

  const orderItemRows = await db
    .select()
    .from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, shipment.orderId));
  const orderItemPriceMap = new Map(orderItemRows.map((oi) => [oi.productId, Number(oi.price)]));

  const items = itemRows.map((row) => ({
    id: row.item.id,
    productId: row.item.productId,
    productName: row.product.name,
    productUnit: row.product.unit,
    quantity: Number(row.item.quantity),
    price: orderItemPriceMap.get(row.item.productId) ?? Number(row.product.price),
  }));

  const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.price, 0);

  return {
    id: shipment.id,
    orderId: shipment.orderId,
    orderNumber,
    clientName: orderRow?.clientName ?? "",
    siteId: shipment.siteId,
    siteName: site?.name ?? "",
    siteAddress: site?.address ?? "",
    driverUserId: shipment.driverUserId,
    driver: driverUser?.name || driverUser?.email || "Не назначен",
    shipmentDate: shipment.shipmentDate,
    note: shipment.note,
    items,
    totalAmount,
    isDispatched: shipment.isDispatched,
    dispatchedAt: shipment.dispatchedAt,
    isDeleted: shipment.isDeleted,
    deletedAt: shipment.deletedAt,
    deleteNote: shipment.deleteNote,
    createdAt: shipment.createdAt,
  };
}
