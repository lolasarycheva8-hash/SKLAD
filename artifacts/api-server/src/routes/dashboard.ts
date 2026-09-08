import { Router, type IRouter } from "express";
import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { db, productsTable, deliveriesTable, sitesTable, appUsersTable } from "@workspace/db";
import {
  GetDashboardSummaryResponse,
  GetDeliveryDashboardSummaryQueryParams,
  GetDeliveryDashboardSummaryResponse,
} from "@workspace/api-zod";
import { getCurrentStockMap } from "../lib/stock";
import { toDeliveryDto, monthRange, currentMonth, todayLocalISO } from "../lib/deliveries";
import { cached } from "../lib/cache";
import { requireAdmin } from "../middlewares/requirePermission";

const router: IRouter = Router();
router.use("/dashboard", requireAdmin);

router.get("/dashboard/delivery-summary", async (req, res): Promise<void> => {
  const query = GetDeliveryDashboardSummaryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const month = query.data.month ?? currentMonth();
  const { start, end } = monthRange(month);

  const rows = await db
    .select({
      delivery: deliveriesTable,
      siteName: sitesTable.name,
      siteAddress: sitesTable.address,
      driverName: appUsersTable.name,
      driverEmail: appUsersTable.email,
    })
    .from(deliveriesTable)
    .innerJoin(sitesTable, eq(deliveriesTable.siteId, sitesTable.id))
    .leftJoin(appUsersTable, eq(deliveriesTable.driverUserId, appUsersTable.id))
    .where(or(
      eq(deliveriesTable.scheduleMonth, month),
      and(
        isNull(deliveriesTable.scheduleMonth),
        gte(deliveriesTable.plannedDate, start),
        lt(deliveriesTable.plannedDate, end),
      ),
    ))
    .orderBy(sql`${deliveriesTable.plannedDate} asc nulls last`);

  const dtos = rows.map((row) => toDeliveryDto(
    row.delivery,
    row.siteName,
    row.siteAddress,
    0,
    row.driverName || row.driverEmail || "Не назначен",
  ));

  const totalScheduled = dtos.length;
  const undatedCount = dtos.filter((d) => d.plannedDate === null).length;
  const dueDeliveries = dtos.filter((d) => d.status !== "pending");
  const onTimeDeliveries = dtos.filter((d) => d.status === "on_time");
  const lateDeliveries = dtos.filter((d) => d.status === "late");
  const overdueDeliveries = dtos.filter((d) => d.status === "overdue");

  const dueCount = dueDeliveries.length;
  const onTimeCount = onTimeDeliveries.length;
  const lateCount = lateDeliveries.length;
  const overdueCount = overdueDeliveries.length;

  const planFactPercent = dueCount > 0 ? (onTimeCount / dueCount) * 100 : 0;

  const lagValues = dtos.filter((d) => d.lagDays !== null).map((d) => d.lagDays as number);
  const avgLagDays =
    lagValues.length > 0 ? lagValues.reduce((sum, v) => sum + v, 0) / lagValues.length : 0;

  const driverMap = new Map<string, { total: number; onTime: number }>();
  for (const d of dueDeliveries) {
    const entry = driverMap.get(d.driver) ?? { total: 0, onTime: 0 };
    entry.total += 1;
    if (d.status === "on_time") entry.onTime += 1;
    driverMap.set(d.driver, entry);
  }

  const planFactByDriver = [...driverMap.entries()]
    .map(([driver, stats]) => ({
      driver,
      total: stats.total,
      onTime: stats.onTime,
      planFactPercent: stats.total > 0 ? (stats.onTime / stats.total) * 100 : 0,
    }))
    .sort((a, b) => a.driver.localeCompare(b.driver));

  const today = todayLocalISO();
  const todayRows = await db
    .select({
      delivery: deliveriesTable,
      siteName: sitesTable.name,
      siteAddress: sitesTable.address,
      driverName: appUsersTable.name,
      driverEmail: appUsersTable.email,
    })
    .from(deliveriesTable)
    .innerJoin(sitesTable, eq(deliveriesTable.siteId, sitesTable.id))
    .leftJoin(appUsersTable, eq(deliveriesTable.driverUserId, appUsersTable.id))
    .where(eq(deliveriesTable.plannedDate, today));

  const todayTotal = todayRows.length;
  const todayDeliveries = todayRows
    .map((row) => toDeliveryDto(
      row.delivery,
      row.siteName,
      row.siteAddress,
      0,
      row.driverName || row.driverEmail || "Не назначен",
    ))
    .sort((a, b) => a.driver.localeCompare(b.driver) || a.siteName.localeCompare(b.siteName));
  const todayDriverMap = new Map<string, { count: number; done: number }>();
  for (const row of todayRows) {
    const driver = row.driverName || row.driverEmail || "Не назначен";
    const entry = todayDriverMap.get(driver) ?? { count: 0, done: 0 };
    entry.count += 1;
    if (row.delivery.actualDate !== null) entry.done += 1;
    todayDriverMap.set(driver, entry);
  }
  const todayByDriver = [...todayDriverMap.entries()]
    .map(([driver, stats]) => ({ driver, count: stats.count, done: stats.done }))
    .sort((a, b) => b.count - a.count);

  res.json(GetDeliveryDashboardSummaryResponse.parse({
    month,
    totalScheduled,
    undatedCount,
    dueCount,
    onTimeCount,
    lateCount,
    overdueCount,
    planFactPercent,
    avgLagDays,
    planFactByDriver,
    overdueDeliveries,
    todayTotal,
    todayByDriver,
    todayDeliveries,
  }));
});

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const payload = await cached("dashboard:summary", 15_000, async () => {
    const products = await db.select().from(productsTable);
    const stockMap = await getCurrentStockMap();

    const lowStockCount = products.filter((product) => {
      const currentStock = stockMap.get(product.id) ?? 0;
      const minStock = Number(product.minStock);
      return minStock > 0 && currentStock <= minStock * 0.6;
    }).length;

    return GetDashboardSummaryResponse.parse({ lowStockCount });
  });

  res.json(payload);
});

export default router;
