import { Router, type IRouter } from "express";
import { and, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, deliveriesTable, sitesTable, appUsersTable } from "@workspace/db";
import {
  ListMyDeliveriesQueryParams,
  ListMyDeliveriesResponse,
  MarkMyDeliveryDoneParams,
  MarkMyDeliveryDoneResponse,
  UpdateMyDeliveryCommentParams,
  UpdateMyDeliveryCommentBody,
  UpdateMyDeliveryCommentResponse,
  GetMySitesSummaryQueryParams,
  GetMySitesSummaryResponse,
} from "@workspace/api-zod";
import { toDeliveryDto, todayLocalISO, photosCountMap } from "../lib/deliveries";
import { getMyDeliveriesAccess } from "../lib/my-deliveries-access";
import { isDriverUser } from "../lib/user-roles";
import { requireDriver } from "../middlewares/requirePermission";

const router: IRouter = Router();
router.use("/my", requireDriver);

router.get("/my/deliveries", async (req, res): Promise<void> => {
  const query = ListMyDeliveriesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const user = req.appUser;
  const access = getMyDeliveriesAccess(user);
  const siteIds = user?.assignedSiteIds ?? null;

  if (access === "none") {
    res.json(ListMyDeliveriesResponse.parse([]));
    return;
  }

  const conditions = [];
  if (access === "driver" && user) {
    conditions.push(eq(deliveriesTable.driverUserId, user.id));
  } else if (siteIds && siteIds.length > 0) {
    conditions.push(inArray(deliveriesTable.siteId, siteIds));
  }
  if (query.data.siteId) {
    conditions.push(eq(deliveriesTable.siteId, query.data.siteId));
  }
  if (query.data.from) {
    conditions.push(gte(deliveriesTable.plannedDate, query.data.from));
  }
  if (query.data.to) {
    conditions.push(lte(deliveriesTable.plannedDate, query.data.to));
  }
  if (query.data.search) {
    conditions.push(
      or(
        ilike(sitesTable.name, `%${query.data.search}%`),
        ilike(sitesTable.address, `%${query.data.search}%`),
      )!,
    );
  }

  const rows = await db
    .select({
      delivery: deliveriesTable,
      siteName: sitesTable.name,
      siteAddress: sitesTable.address,
      managerContact: sitesTable.managerContact,
      driverName: appUsersTable.name,
      driverEmail: appUsersTable.email,
    })
    .from(deliveriesTable)
    .innerJoin(sitesTable, eq(deliveriesTable.siteId, sitesTable.id))
    .leftJoin(appUsersTable, eq(deliveriesTable.driverUserId, appUsersTable.id))
    .where(and(...conditions))
    .orderBy(sql`${deliveriesTable.plannedDate} asc nulls last`);

  const counts = await photosCountMap(rows.map((row) => row.delivery.id));
  res.json(
    ListMyDeliveriesResponse.parse(
      rows.map((row) =>
        toDeliveryDto(
          row.delivery,
          row.siteName,
          row.siteAddress,
          counts.get(row.delivery.id) ?? 0,
          row.driverName || row.driverEmail || "Не назначен",
          row.managerContact || null,
        ),
      ),
    ),
  );
});

router.post("/my/deliveries/:id/done", async (req, res): Promise<void> => {
  const params = MarkMyDeliveryDoneParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const driverUserId =
    req.appUser && isDriverUser(req.appUser) ? req.appUser.id : null;
  if (!driverUserId) {
    res.status(403).json({ error: "Только пользователь-водитель может отметить доставку" });
    return;
  }

  const [existing] = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, params.data.id));

  if (!existing) {
    res.status(404).json({ error: "Доставка не найдена" });
    return;
  }
  if (existing.driverUserId !== driverUserId) {
    res.status(403).json({ error: "Это доставка другого водителя" });
    return;
  }
  if (existing.actualDate) {
    res.status(400).json({ error: "Доставка уже отмечена выполненной" });
    return;
  }
  if (!existing.plannedDate) {
    res.status(409).json({ error: "Сначала назначьте плановую дату доставки" });
    return;
  }

  const actualDate = todayLocalISO();
  if (actualDate.slice(0, 7) !== (existing.scheduleMonth ?? existing.plannedDate.slice(0, 7))) {
    res.status(400).json({
      error: "Фактическая дата должна быть в том же месяце, что и плановая",
    });
    return;
  }

  const [updated] = await db
    .update(deliveriesTable)
    .set({ actualDate, actApprovedAt: null, actApprovedBy: null })
    .where(and(
      eq(deliveriesTable.id, params.data.id),
      eq(deliveriesTable.driverUserId, driverUserId),
    ))
    .returning();
  if (!updated) {
    res.status(403).json({ error: "Назначение водителя изменилось" });
    return;
  }

  const [site] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.id, updated.siteId));

  req.log.info(
    { deliveryId: updated.id, driverUserId, userId: req.appUser?.id },
    "Delivery marked done by driver",
  );
  res.json(MarkMyDeliveryDoneResponse.parse(
    toDeliveryDto(
      updated,
      site?.name ?? "",
      site?.address ?? "",
      0,
      req.appUser?.name || req.appUser?.email || "Не назначен",
    ),
  ));
});

router.patch("/my/deliveries/:id/comment", async (req, res): Promise<void> => {
  const params = UpdateMyDeliveryCommentParams.safeParse(req.params);
  const body = UpdateMyDeliveryCommentBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const driverUserId =
    req.appUser && isDriverUser(req.appUser) ? req.appUser.id : null;
  if (!driverUserId) {
    res.status(403).json({ error: "Только активный водитель может изменить комментарий" });
    return;
  }

  const [updated] = await db
    .update(deliveriesTable)
    .set({ note: body.data.note })
    .where(and(
      eq(deliveriesTable.id, params.data.id),
      eq(deliveriesTable.driverUserId, driverUserId),
      isNull(deliveriesTable.actApprovedAt),
    ))
    .returning();
  if (!updated) {
    const [current] = await db
      .select({
        driverUserId: deliveriesTable.driverUserId,
        actApprovedAt: deliveriesTable.actApprovedAt,
      })
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, params.data.id));
    if (!current) {
      res.status(404).json({ error: "Доставка не найдена" });
      return;
    }
    if (current.driverUserId !== driverUserId) {
      res.status(403).json({ error: "Доставка не назначена этому водителю" });
      return;
    }
    res.status(409).json({
      error: current.actApprovedAt
        ? "Комментарий недоступен: доставка закрыта"
        : "Комментарий недоступен: назначение водителя изменилось",
    });
    return;
  }

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, updated.siteId));
  const counts = await photosCountMap([updated.id]);
  req.log.info(
    { deliveryId: updated.id, driverUserId },
    "Delivery comment updated by driver",
  );
  res.json(UpdateMyDeliveryCommentResponse.parse(
    toDeliveryDto(
      updated,
      site?.name ?? "",
      site?.address ?? "",
      counts.get(updated.id) ?? 0,
      req.appUser?.name || req.appUser?.email || "Не назначен",
    ),
  ));
});

router.get("/my/sites-summary", async (req, res): Promise<void> => {
  const query = GetMySitesSummaryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const siteIds = req.appUser?.assignedSiteIds ?? null;
  if (!siteIds || siteIds.length === 0) {
    res.json(GetMySitesSummaryResponse.parse([]));
    return;
  }

  const sites = await db
    .select()
    .from(sitesTable)
    .where(inArray(sitesTable.id, siteIds));

  const conditions = [inArray(deliveriesTable.siteId, siteIds)];
  if (query.data.from) {
    conditions.push(gte(deliveriesTable.plannedDate, query.data.from));
  }
  if (query.data.to) {
    conditions.push(lte(deliveriesTable.plannedDate, query.data.to));
  }

  const deliveries = await db
    .select()
    .from(deliveriesTable)
    .where(and(...conditions));

  const today = todayLocalISO();
  const bySite = new Map<string, { planned: number; done: number; overdue: number }>();
  for (const d of deliveries) {
    const stat = bySite.get(d.siteId) ?? { planned: 0, done: 0, overdue: 0 };
    stat.planned += 1;
    if (d.actualDate) stat.done += 1;
    else if (d.plannedDate && d.plannedDate < today) stat.overdue += 1;
    bySite.set(d.siteId, stat);
  }

  const driverIds = sites
    .map((site) => site.driverUserId)
    .filter((id): id is string => id !== null);
  const drivers = driverIds.length
    ? await db
        .select({ id: appUsersTable.id, name: appUsersTable.name, email: appUsersTable.email })
        .from(appUsersTable)
        .where(inArray(appUsersTable.id, driverIds))
    : [];
  const driverNames = new Map(drivers.map((driver) => [
    driver.id,
    driver.name || driver.email,
  ]));

  const result = sites
    .map((site) => {
      const stat = bySite.get(site.id) ?? { planned: 0, done: 0, overdue: 0 };
      return {
        siteId: site.id,
        siteName: site.name,
        address: site.address,
        driverUserId: site.driverUserId,
        driver: site.driverUserId
          ? driverNames.get(site.driverUserId) ?? "Не назначен"
          : "Не назначен",
        planned: stat.planned,
        done: stat.done,
        overdue: stat.overdue,
      };
    })
    .sort((a, b) => a.siteName.localeCompare(b.siteName, "ru"));

  res.json(GetMySitesSummaryResponse.parse(result));
});

export default router;
