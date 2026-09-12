import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  categoriesTable,
  clientsTable,
  orderItemsTable,
  ordersTable,
  productsTable,
  shipmentsTable,
  sitesTable,
} from "@workspace/db";
import {
  GetShipmentOrderLookupParams,
  GetShipmentOrderLookupResponse,
  ListInventorySiteLookupResponse,
  ListOrderClientLookupResponse,
  ListOrderProductLookupResponse,
  ListOrderShipmentLookupParams,
  ListOrderShipmentLookupResponse,
  ListReceiptCategoryLookupResponse,
  ListReceiptProductLookupResponse,
  ListShipmentOrderLookupResponse,
  ListShipmentProductLookupResponse,
  ListShipmentSiteLookupResponse,
  ListSiteBranchLookupResponse,
} from "@workspace/api-zod";
import { getCurrentStockMap } from "../lib/stock";
import { toOrderDto } from "../lib/orders";
import { toShipmentDto } from "../lib/shipments";
import {
  requireAnySectionAccess,
  requireSectionAccess,
} from "../middlewares/requirePermission";

const router: IRouter = Router();
const ordersOrShipments = requireAnySectionAccess(["orders", "shipments"]);

async function shipmentOrder(id: string) {
  const [row] = await db
    .select({ order: ordersTable, clientName: clientsTable.name })
    .from(ordersTable)
    .innerJoin(clientsTable, eq(ordersTable.clientId, clientsTable.id))
    .where(eq(ordersTable.id, id));
  return row ? toOrderDto(row.order, row.clientName) : undefined;
}

router.get(
  "/lookups/site-branches",
  requireSectionAccess("sites"),
  async (_req, res) => {
    const trimmedBranch = sql<string>`btrim(${sitesTable.branch}, chr(32) || chr(9) || chr(10) || chr(13) || chr(12) || chr(11) || chr(160))`;
    const rows = await db
      .selectDistinct({ name: trimmedBranch })
      .from(sitesTable)
      .where(sql`${trimmedBranch} <> ''`)
      .orderBy(trimmedBranch);
    res.json(ListSiteBranchLookupResponse.parse(rows));
  },
);

router.get(
  "/lookups/receipt-products",
  requireAnySectionAccess(["receipts"]),
  async (_req, res) => {
    const rows = await db
      .select()
      .from(productsTable)
      .orderBy(productsTable.name);
    const stock = await getCurrentStockMap();
    res.json(
      ListReceiptProductLookupResponse.parse(
        rows.map((product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          unit: product.unit,
          categoryId: product.categoryId,
          purchasePrice: Number(product.purchasePrice),
          price: Number(product.price),
          minStock: Number(product.minStock),
          supplier: product.supplier,
          supplierContact: product.supplierContact,
          currentStock: stock.get(product.id) ?? 0,
        })),
      ),
    );
  },
);

router.get(
  "/lookups/receipt-categories",
  requireAnySectionAccess(["receipts"]),
  async (_req, res) => {
    const rows = await db
      .select({ id: categoriesTable.id, name: categoriesTable.name })
      .from(categoriesTable)
      .orderBy(categoriesTable.name);
    res.json(ListReceiptCategoryLookupResponse.parse(rows));
  },
);

router.get(
  "/lookups/order-clients",
  requireAnySectionAccess(["orders", "sites"]),
  async (_req, res) => {
    const rows = await db
      .select({ id: clientsTable.id, name: clientsTable.name })
      .from(clientsTable)
      .orderBy(clientsTable.name);
    res.json(ListOrderClientLookupResponse.parse(rows));
  },
);

router.get(
  "/lookups/order-products",
  requireAnySectionAccess(["orders"]),
  async (_req, res) => {
    const rows = await db
      .select({
        id: productsTable.id,
        name: productsTable.name,
        unit: productsTable.unit,
        price: productsTable.price,
      })
      .from(productsTable)
      .orderBy(productsTable.name);
    res.json(
      ListOrderProductLookupResponse.parse(
        rows.map((row) => ({ ...row, price: Number(row.price) })),
      ),
    );
  },
);

router.get(
  "/lookups/inventory-sites",
  requireAnySectionAccess(["inventory"]),
  async (_req, res) => {
    const rows = await db
      .select({ id: sitesTable.id, name: sitesTable.name })
      .from(sitesTable)
      .orderBy(sitesTable.name);
    res.json(ListInventorySiteLookupResponse.parse(rows));
  },
);

router.get(
  "/lookups/shipment-products",
  ordersOrShipments,
  async (_req, res) => {
    const rows = await db
      .select({
        id: productsTable.id,
        name: productsTable.name,
        unit: productsTable.unit,
        price: productsTable.price,
      })
      .from(productsTable)
      .orderBy(productsTable.name);
    res.json(
      ListShipmentProductLookupResponse.parse(
        rows.map((row) => ({ ...row, price: Number(row.price) })),
      ),
    );
  },
);

router.get("/lookups/shipment-sites", ordersOrShipments, async (_req, res) => {
  const rows = await db
    .select({
      id: sitesTable.id,
      name: sitesTable.name,
      driverUserId: sitesTable.driverUserId,
    })
    .from(sitesTable)
    .orderBy(sitesTable.name);
  res.json(ListShipmentSiteLookupResponse.parse(rows));
});

router.get(
  "/lookups/shipment-orders",
  requireAnySectionAccess(["shipments"]),
  async (_req, res) => {
    const rows = await db
      .select({ order: ordersTable, clientName: clientsTable.name })
      .from(ordersTable)
      .innerJoin(clientsTable, eq(ordersTable.clientId, clientsTable.id))
      .orderBy(ordersTable.createdAt);
    res.json(
      ListShipmentOrderLookupResponse.parse(
        await Promise.all(
          rows.map((row) => toOrderDto(row.order, row.clientName)),
        ),
      ),
    );
  },
);

router.get(
  "/lookups/shipment-orders/:id",
  requireAnySectionAccess(["shipments"]),
  async (req, res): Promise<void> => {
    const params = GetShipmentOrderLookupParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const order = await shipmentOrder(params.data.id);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.json(GetShipmentOrderLookupResponse.parse(order));
  },
);

router.get(
  "/orders/:id/shipments",
  requireAnySectionAccess(["orders"]),
  async (req, res): Promise<void> => {
    const params = ListOrderShipmentLookupParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const rows = await db
      .select()
      .from(shipmentsTable)
      .where(eq(shipmentsTable.orderId, params.data.id))
      .orderBy(shipmentsTable.createdAt);
    const shipments = await Promise.all(rows.map(toShipmentDto));
    res.json(
      ListOrderShipmentLookupResponse.parse(
        shipments.map(
          ({
            id,
            siteName,
            driver,
            shipmentDate,
            totalAmount,
            isDispatched,
            isDeleted,
          }) => ({
            id,
            siteName,
            driver,
            shipmentDate,
            totalAmount,
            isDispatched,
            isDeleted,
          }),
        ),
      ),
    );
  },
);

export default router;
