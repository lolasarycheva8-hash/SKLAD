import { Router, type IRouter, type Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db, inventoryRecordsTable } from "@workspace/db";
import {
  BulkCreateInventoryRecordsBody,
  BulkCreateInventoryRecordsResponse,
  CreateInventoryRecordBody,
  CreateInventoryRecordResponse,
  DeleteInventoryRecordParams,
  ListInventoryRecordsQueryParams,
  ListInventoryRecordsResponse,
  UpdateInventoryRecordBody,
  UpdateInventoryRecordParams,
  UpdateInventoryRecordResponse,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requirePermission";
import {
  createInventoryRecords,
  deleteInventoryRecord,
  InventoryRecordError,
  updateInventoryRecord,
} from "../lib/inventory-records";

const router: IRouter = Router();
// Guard individual routes; router-wide middleware would accidentally guard
// unrelated endpoints registered after this router.
function respondError(res: Response, error: unknown, bulk = false): void {
  if (!(error instanceof InventoryRecordError)) throw error;
  res.status(error.status).json(bulk
    ? { error: error.message, errors: error.errors }
    : { error: error.message });
}

router.get("/inventory-records", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ListInventoryRecordsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conditions = [];
  if (parsed.data.kind) conditions.push(eq(inventoryRecordsTable.kind, parsed.data.kind));
  if (parsed.data.siteId) conditions.push(eq(inventoryRecordsTable.siteId, parsed.data.siteId));
  const records = await db.select().from(inventoryRecordsTable).where(and(...conditions))
    .orderBy(asc(inventoryRecordsTable.name), asc(inventoryRecordsTable.id));
  res.json(ListInventoryRecordsResponse.parse(records));
});

router.post("/inventory-records", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateInventoryRecordBody.strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [record] = await createInventoryRecords([parsed.data]);
    res.status(201).json(CreateInventoryRecordResponse.parse(record));
  } catch (error) {
    respondError(res, error);
  }
});

router.post("/inventory-records/bulk", requireAdmin, async (req, res): Promise<void> => {
  // Generated schemas provide scalar validation; explicitly enforce strict
  // rows because Orval doesn't preserve additionalProperties:false.
  const schema = BulkCreateInventoryRecordsBody.strict().extend({
    rows: BulkCreateInventoryRecordsBody.shape.rows.element.strict().array().min(1).max(1000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Импорт не выполнен: исправьте ошибки в строках",
      errors: parsed.error.issues.map((issue) => ({
        row: typeof issue.path[1] === "number" ? issue.path[1] + 1 : 1,
        field: issue.path.slice(2).join(".") || "rows",
        error: issue.message,
      })),
    });
    return;
  }
  try {
    const records = await createInventoryRecords(parsed.data.rows);
    res.status(201).json(BulkCreateInventoryRecordsResponse.parse({ records, created: records.length }));
  } catch (error) {
    respondError(res, error, true);
  }
});

router.patch("/inventory-records/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateInventoryRecordParams.safeParse(req.params);
  const parsed = UpdateInventoryRecordBody.strict().safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : !parsed.success ? parsed.error.message : "Некорректные данные" });
    return;
  }
  if (!Object.keys(parsed.data).length) {
    res.status(400).json({ error: "Укажите поля для изменения" });
    return;
  }
  try {
    res.json(UpdateInventoryRecordResponse.parse(await updateInventoryRecord(params.data.id, parsed.data)));
  } catch (error) {
    respondError(res, error);
  }
});

router.delete("/inventory-records/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteInventoryRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    await deleteInventoryRecord(params.data.id);
    res.sendStatus(204);
  } catch (error) {
    respondError(res, error);
  }
});

export default router;