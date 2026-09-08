import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, deliveryTypesTable, sitesTable } from "@workspace/db";
import {
  ListDeliveryTypesResponse,
  CreateDeliveryTypeBody,
  CreateDeliveryTypeResponse,
  DeleteDeliveryTypeParams,
} from "@workspace/api-zod";
import { requirePermission, requireSectionAccess } from "../middlewares/requirePermission";

const router: IRouter = Router();
router.use("/delivery-types", requireSectionAccess("sites"));
const canEditSites = requirePermission("sites");

function toDto(row: typeof deliveryTypesTable.$inferSelect) {
  return { id: row.id, name: row.name, createdAt: row.createdAt };
}

router.get("/delivery-types", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(deliveryTypesTable)
    .orderBy(deliveryTypesTable.name);
  res.json(ListDeliveryTypesResponse.parse(rows.map(toDto)));
});

router.post("/delivery-types", canEditSites, async (req, res): Promise<void> => {
  const parsed = CreateDeliveryTypeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Название не может быть пустым" });
    return;
  }
  const [created] = await db
    .insert(deliveryTypesTable)
    .values({ name })
    .onConflictDoNothing({ target: deliveryTypesTable.name })
    .returning();
  if (!created) {
    res.status(409).json({ error: "Такой тип поставки уже есть в справочнике" });
    return;
  }
  res.status(201).json(CreateDeliveryTypeResponse.parse(toDto(created)));
});

router.delete(
  "/delivery-types/:id",
  canEditSites,
  async (req, res): Promise<void> => {
    const params = DeleteDeliveryTypeParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [row] = await db
      .select()
      .from(deliveryTypesTable)
      .where(eq(deliveryTypesTable.id, params.data.id));
    if (!row) {
      res.status(204).end();
      return;
    }
    const [used] = await db
      .select({ id: sitesTable.id })
      .from(sitesTable)
      .where(eq(sitesTable.deliveryType, row.name))
      .limit(1);
    if (used) {
      res.status(409).json({
        error: `Тип «${row.name}» используется у объектов — сначала измените его у этих объектов.`,
      });
      return;
    }
    await db
      .delete(deliveryTypesTable)
      .where(eq(deliveryTypesTable.id, params.data.id));
    res.status(204).end();
  },
);

export default router;
