import { Router, type IRouter, type Response } from "express";
import { and, desc, eq, isNull, isNotNull } from "drizzle-orm";
import { db, orderSummariesTable } from "@workspace/db";
import {
  PreviewOrderSummaryBody, PreviewOrderSummaryResponse,
  CreateOrderSummaryBody, CreateOrderSummaryResponse,
  ListOrderSummariesQueryParams, ListOrderSummariesResponse,
  GetOrderSummaryParams, GetOrderSummaryResponse,
  PayOrderSummaryParams, PayOrderSummaryResponse,
} from "@workspace/api-zod";
import { requirePermission, requireSectionAccess } from "../middlewares/requirePermission";
import { BillingError, previewSummary, createSummary, paySummary, summaryDto } from "../lib/order-summaries";
import { isDriverUser } from "../lib/user-roles";

const router: IRouter = Router();
router.use("/order-summaries", (req, res, next) => {
  if (req.appUser && isDriverUser(req.appUser)) {
    res.status(403).json({ error: "Раздел недоступен водителю" });
    return;
  }
  next();
}, requireSectionAccess("orders"));
const edit = requirePermission("orders");
function billingError(error: unknown, res: Response) {
  if (!(error instanceof BillingError)) throw error;
  res.status(error.status).json({ error: error.message, blockers: error.blockers });
}

router.post("/order-summaries/preview", async (req, res): Promise<void> => {
  const body = PreviewOrderSummaryBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  try { res.json(PreviewOrderSummaryResponse.parse(await previewSummary(body.data))); }
  catch (error) { billingError(error, res); }
});
router.post("/order-summaries", edit, async (req, res): Promise<void> => {
  const body = CreateOrderSummaryBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  try { res.status(201).json(CreateOrderSummaryResponse.parse(await createSummary(body.data))); }
  catch (error) { billingError(error, res); }
});
router.get("/order-summaries", async (req, res): Promise<void> => {
  const query = ListOrderSummariesQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const conditions = [];
  if (query.data.clientId) conditions.push(eq(orderSummariesTable.clientId, query.data.clientId));
  if (query.data.status) conditions.push(query.data.status === "paid" ? isNotNull(orderSummariesTable.paidAt) : isNull(orderSummariesTable.paidAt));
  const summaries = await db.select().from(orderSummariesTable).where(and(...conditions)).orderBy(desc(orderSummariesTable.createdAt));
  res.json(ListOrderSummariesResponse.parse(await Promise.all(summaries.map((s) => summaryDto(s)))));
});
router.get("/order-summaries/:id", async (req, res): Promise<void> => {
  const params = GetOrderSummaryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [summary] = await db.select().from(orderSummariesTable).where(eq(orderSummariesTable.id, params.data.id));
  if (!summary) { res.status(404).json({ error: "Сводный счёт не найден" }); return; }
  res.json(GetOrderSummaryResponse.parse(await summaryDto(summary)));
});
router.post("/order-summaries/:id/pay", edit, async (req, res): Promise<void> => {
  const params = PayOrderSummaryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try { res.json(PayOrderSummaryResponse.parse(await paySummary(params.data.id))); }
  catch (error) { billingError(error, res); }
});
export default router;