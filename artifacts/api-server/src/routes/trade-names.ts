import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, tradeNamesTable, sitesTable } from "@workspace/db";
import {
  ListTradeNamesResponse,
  CreateTradeNameBody,
  CreateTradeNameResponse,
  DeleteTradeNameParams,
} from "@workspace/api-zod";
import { requirePermission, requireSectionAccess } from "../middlewares/requirePermission";

const router: IRouter = Router();
router.use("/trade-names", requireSectionAccess("sites"));
const canEditSites = requirePermission("sites");

function toDto(row: typeof tradeNamesTable.$inferSelect) {
  return { id: row.id, name: row.name, createdAt: row.createdAt };
}

router.get("/trade-names", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(tradeNamesTable)
    .orderBy(tradeNamesTable.name);
  res.json(ListTradeNamesResponse.parse(rows.map(toDto)));
});

router.post("/trade-names", canEditSites, async (req, res): Promise<void> => {
  const parsed = CreateTradeNameBody.safeParse(req.body);
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
    .insert(tradeNamesTable)
    .values({ name })
    .onConflictDoNothing({ target: tradeNamesTable.name })
    .returning();
  if (!created) {
    res.status(409).json({ error: "Такое название уже есть в справочнике" });
    return;
  }
  res.status(201).json(CreateTradeNameResponse.parse(toDto(created)));
});

router.delete("/trade-names/:id", canEditSites, async (req, res): Promise<void> => {
  const params = DeleteTradeNameParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(tradeNamesTable)
    .where(eq(tradeNamesTable.id, params.data.id));
  if (!row) {
    res.status(204).end();
    return;
  }
  const [used] = await db
    .select({ id: sitesTable.id })
    .from(sitesTable)
    .where(eq(sitesTable.customer, row.name))
    .limit(1);
  if (used) {
    res.status(409).json({
      error: `Название «${row.name}» используется у объектов — сначала измените его у этих объектов.`,
    });
    return;
  }
  await db.delete(tradeNamesTable).where(eq(tradeNamesTable.id, params.data.id));
  res.status(204).end();
});

export default router;
