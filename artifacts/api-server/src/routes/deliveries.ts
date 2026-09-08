import { Router, type IRouter } from "express";
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  lt,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  deliveriesTable,
  deliveryPhotosTable,
  sitesTable,
  appUsersTable,
} from "@workspace/db";
import {
  ListDeliveriesQueryParams,
  CreateDeliveryBody,
  CreateDeliveriesBulkBody,
  ReplaceDeliveriesBulkBody,
  UpdateDeliveriesActualBulkBody,
  UpdateDeliveryParams,
  UpdateDeliveryBody,
  DeleteDeliveryParams,
  ListDeliveriesResponse,
  CreateDeliveryResponse,
  CreateDeliveriesBulkResponse,
  ReplaceDeliveriesBulkResponse,
  UpdateDeliveriesActualBulkResponse,
  UpdateDeliveryResponse,
  RescheduleDeliveryParams,
  RescheduleDeliveryBody,
  RescheduleDeliveryResponse,
  ApproveDeliveryActParams,
  ApproveDeliveryActResponse,
  ListDeliveryPhotosParams,
  ListDeliveryPhotosResponse,
  AddDeliveryPhotoParams,
  AddDeliveryPhotoBody,
  AddDeliveryPhotoResponse,
  DeleteDeliveryPhotoParams,
  ListDeliverySiteLookupResponse,
} from "@workspace/api-zod";
import { toDeliveryDto, monthRange, photosCountMap } from "../lib/deliveries";
import {
  requireAdmin,
  requireDeliveryActApproval,
  requirePermission,
  requireSectionAccess,
} from "../middlewares/requirePermission";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  canAccessDeliveryActs,
  canEditDeliveries as canUserEditDeliveries,
  canUploadDeliveryActs,
  isAllowedDeliveryActMimeType,
  isDateInPlannedMonth,
  isDeliveryActAlreadyAttached,
  isUploadObjectPath,
} from "../lib/delivery-acts";
import { findInvalidDriverUserIds } from "../lib/drivers";
import { acquireDeliveryUploadLock } from "../lib/delivery-upload-lock";

const router: IRouter = Router();
const canEditDeliveries = requirePermission("deliveries");
const objectStorageService = new ObjectStorageService();

router.get(
  "/deliveries/site-lookup",
  requireSectionAccess("deliveries"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({
        id: sitesTable.id,
        name: sitesTable.name,
        address: sitesTable.address,
        branch: sitesTable.branch,
        manager: sitesTable.manager,
        deliveryType: sitesTable.deliveryType,
        client: sitesTable.client,
        driverUserId: sitesTable.driverUserId,
        isClosed: sql<boolean>`${sitesTable.closedFrom} is not null`,
      })
      .from(sitesTable)
      .orderBy(sitesTable.name);
    const driverIds = rows
      .map((row) => row.driverUserId)
      .filter((id): id is string => id !== null);
    const drivers = driverIds.length
      ? await db
          .select({
            id: appUsersTable.id,
            name: appUsersTable.name,
            email: appUsersTable.email,
          })
          .from(appUsersTable)
          .where(inArray(appUsersTable.id, driverIds))
      : [];
    const driverNames = new Map(
      drivers.map((driver) => [driver.id, driver.name || driver.email]),
    );
    res.json(
      ListDeliverySiteLookupResponse.parse(
        rows.map((row) => ({
          ...row,
          branch: row.branch ?? "",
          manager: row.manager ?? "",
          deliveryType: row.deliveryType ?? "",
          client: row.client ?? "",
          driver: row.driverUserId
            ? (driverNames.get(row.driverUserId) ?? "Не назначен")
            : "Не назначен",
        })),
      ),
    );
  },
);

function dateString(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function effectiveMonth(
  plannedDate: string | null,
  scheduleMonth: string | null,
): string | null {
  return scheduleMonth ?? plannedDate?.slice(0, 7) ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function monthCondition(month: string) {
  const { start, end } = monthRange(month);
  return or(
    eq(deliveriesTable.scheduleMonth, month),
    and(
      isNull(deliveriesTable.scheduleMonth),
      gte(deliveriesTable.plannedDate, start),
      lt(deliveriesTable.plannedDate, end),
    ),
  )!;
}

async function getDriverName(driverUserId: string | null): Promise<string> {
  if (!driverUserId) return "Не назначен";
  const [user] = await db
    .select({ name: appUsersTable.name, email: appUsersTable.email })
    .from(appUsersTable)
    .where(eq(appUsersTable.id, driverUserId));
  return user?.name || user?.email || "Не назначен";
}

function userCanEditDeliveries(
  req: Parameters<typeof canEditDeliveries>[0],
): boolean {
  return canUserEditDeliveries(req.appUser);
}

async function cleanupRejectedObject(
  req: Parameters<typeof canEditDeliveries>[0],
  objectPath: string,
): Promise<void> {
  if (!isUploadObjectPath(objectPath)) return;

  try {
    await db.transaction(async (tx) => {
      await acquireDeliveryUploadLock(tx, objectPath);
      const [attached] = await tx
        .select({ id: deliveryPhotosTable.id })
        .from(deliveryPhotosTable)
        .where(eq(deliveryPhotosTable.objectPath, objectPath))
        .limit(1);
      if (attached) return;

      await objectStorageService.deleteObjectEntity(objectPath);
    });
  } catch (error) {
    req.log?.error(
      { err: error, objectPath },
      "Failed to clean up rejected delivery act object",
    );
  }
}

function getRejectedUploadObjectPath(body: unknown): string | null {
  if (
    typeof body !== "object" ||
    body === null ||
    !("objectPath" in body) ||
    typeof body.objectPath !== "string" ||
    !isUploadObjectPath(body.objectPath)
  ) {
    return null;
  }
  return body.objectPath;
}

async function deleteAttachedObject(
  req: Parameters<typeof canEditDeliveries>[0],
  objectPath: string,
): Promise<boolean> {
  try {
    await objectStorageService.deleteObjectEntity(objectPath);
    return true;
  } catch (error) {
    req.log?.error(
      { err: error, objectPath },
      "Failed to delete delivery act object",
    );
    return false;
  }
}

router.get(
  "/deliveries",
  requireSectionAccess("deliveries"),
  async (req, res): Promise<void> => {
    const query = ListDeliveriesQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }

    const conditions = [];
    if (query.data.siteId) {
      conditions.push(eq(deliveriesTable.siteId, query.data.siteId));
    }
    if (query.data.driverUserId) {
      conditions.push(
        eq(deliveriesTable.driverUserId, query.data.driverUserId),
      );
    }
    if (query.data.dateFrom || query.data.dateTo) {
      if (query.data.dateFrom) {
        conditions.push(gte(deliveriesTable.plannedDate, query.data.dateFrom));
      }
      if (query.data.dateTo) {
        conditions.push(lte(deliveriesTable.plannedDate, query.data.dateTo));
      }
    } else if (query.data.month) {
      conditions.push(monthCondition(query.data.month));
    }

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
      .leftJoin(
        appUsersTable,
        eq(deliveriesTable.driverUserId, appUsersTable.id),
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(sql`${deliveriesTable.plannedDate} asc nulls last`);

    const counts = await photosCountMap(rows.map((row) => row.delivery.id));
    let dtos = rows.map((row) =>
      toDeliveryDto(
        row.delivery,
        row.siteName,
        row.siteAddress,
        counts.get(row.delivery.id) ?? 0,
        row.driverName || row.driverEmail || "Не назначен",
      ),
    );

    if (query.data.status) {
      dtos = dtos.filter((d) => d.status === query.data.status);
    }

    res.json(ListDeliveriesResponse.parse(dtos));
  },
);

router.post(
  "/deliveries",
  canEditDeliveries,
  async (req, res): Promise<void> => {
    const parsed = CreateDeliveryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [site] = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.id, parsed.data.siteId));
    if (!site) {
      res.status(404).json({ error: "Site not found" });
      return;
    }
    if (
      (await findInvalidDriverUserIds([parsed.data.driverUserId])).length > 0
    ) {
      res
        .status(400)
        .json({ error: "Выбранный пользователь не является водителем" });
      return;
    }
    const plannedDate = dateString(parsed.data.plannedDate);
    const scheduleMonth =
      parsed.data.scheduleMonth ?? plannedDate?.slice(0, 7) ?? null;
    if (!scheduleMonth) {
      res
        .status(400)
        .json({
          error: "Для доставки без даты необходимо указать месяц графика",
        });
      return;
    }
    if (plannedDate && plannedDate.slice(0, 7) !== scheduleMonth) {
      res
        .status(400)
        .json({ error: "Плановая дата должна относиться к месяцу графика" });
      return;
    }

    let delivery: typeof deliveriesTable.$inferSelect;
    try {
      [delivery] = await db
        .insert(deliveriesTable)
        .values({
          siteId: parsed.data.siteId,
          driverUserId: parsed.data.driverUserId ?? null,
          plannedDate,
          scheduleMonth,
          note: parsed.data.note ?? null,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "Такая строка графика уже существует" });
        return;
      }
      throw error;
    }

    res
      .status(201)
      .json(
        CreateDeliveryResponse.parse(
          toDeliveryDto(
            delivery,
            site.name,
            site.address,
            0,
            await getDriverName(delivery.driverUserId),
          ),
        ),
      );
  },
);

router.post(
  "/deliveries/bulk",
  canEditDeliveries,
  async (req, res): Promise<void> => {
    const parsed = CreateDeliveriesBulkBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const siteIds = [...new Set(parsed.data.items.map((item) => item.siteId))];
    const sites = await db.select().from(sitesTable);
    const siteMap = new Map(sites.map((s) => [s.id, s]));

    const missing = siteIds.filter((id) => !siteMap.has(id));
    if (missing.length > 0) {
      res.status(404).json({ error: `Sites not found: ${missing.join(", ")}` });
      return;
    }
    if (parsed.data.items.some((item) => !item.driverUserId)) {
      res.status(400).json({
        error:
          "В каждой строке графика должен быть указан водитель из справочника пользователей",
      });
      return;
    }
    if (
      (
        await findInvalidDriverUserIds(
          parsed.data.items.map((item) => item.driverUserId),
        )
      ).length > 0
    ) {
      res
        .status(400)
        .json({
          error: "Один или несколько пользователей не являются водителями",
        });
      return;
    }
    const normalizedItems = parsed.data.items.map((item) => {
      const plannedDate = dateString(item.plannedDate);
      return {
        ...item,
        plannedDate,
        scheduleMonth: item.scheduleMonth ?? plannedDate?.slice(0, 7) ?? null,
      };
    });
    if (normalizedItems.some((item) => !item.scheduleMonth)) {
      res
        .status(400)
        .json({
          error: "Для доставки без даты необходимо указать месяц графика",
        });
      return;
    }
    if (
      normalizedItems.some(
        (item) =>
          item.plannedDate &&
          item.plannedDate.slice(0, 7) !== item.scheduleMonth,
      )
    ) {
      res
        .status(400)
        .json({ error: "Плановая дата должна относиться к месяцу графика" });
      return;
    }

    const existingDeliveries = await db
      .select({
        siteId: deliveriesTable.siteId,
        plannedDate: deliveriesTable.plannedDate,
        scheduleMonth: deliveriesTable.scheduleMonth,
      })
      .from(deliveriesTable);
    const existingKeys = new Set(
      existingDeliveries.map(
        (delivery) =>
          `${delivery.siteId}:${effectiveMonth(delivery.plannedDate, delivery.scheduleMonth)}:${delivery.plannedDate ?? "undated"}`,
      ),
    );
    const newKeys = new Set<string>();
    const newItems = normalizedItems.filter((item) => {
      const key = `${item.siteId}:${item.scheduleMonth}:${item.plannedDate ?? "undated"}`;
      if (existingKeys.has(key) || newKeys.has(key)) return false;
      newKeys.add(key);
      return true;
    });

    if (newItems.length === 0) {
      res.status(201).json(CreateDeliveriesBulkResponse.parse([]));
      return;
    }

    const inserted = await db
      .insert(deliveriesTable)
      .values(
        newItems.map((item) => ({
          siteId: item.siteId,
          driverUserId: item.driverUserId ?? null,
          plannedDate: item.plannedDate,
          scheduleMonth: item.scheduleMonth!,
          note: item.note ?? null,
        })),
      )
      .returning();

    const dtos = await Promise.all(
      inserted.map(async (row) =>
        toDeliveryDto(
          row,
          siteMap.get(row.siteId)!.name,
          siteMap.get(row.siteId)!.address,
          0,
          await getDriverName(row.driverUserId),
        ),
      ),
    );

    res.status(201).json(CreateDeliveriesBulkResponse.parse(dtos));
  },
);

router.post(
  "/deliveries/bulk/actual",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = UpdateDeliveriesActualBulkBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const updates = new Map(
      parsed.data.items.map((item) => [
        item.id,
        item.actualDate.toISOString().slice(0, 10),
      ]),
    );
    if (updates.size === 0) {
      res.json(UpdateDeliveriesActualBulkResponse.parse({ updated: 0 }));
      return;
    }

    const existing = await db
      .select({
        id: deliveriesTable.id,
        plannedDate: deliveriesTable.plannedDate,
        scheduleMonth: deliveriesTable.scheduleMonth,
      })
      .from(deliveriesTable)
      .where(inArray(deliveriesTable.id, [...updates.keys()]));

    if (existing.length !== updates.size) {
      res.status(404).json({ error: "Одна или несколько доставок не найдены" });
      return;
    }
    if (existing.some((delivery) => !delivery.plannedDate)) {
      res
        .status(409)
        .json({ error: "Сначала назначьте плановую дату каждой доставки" });
      return;
    }

    const invalid = existing.find((delivery) => {
      const actualDate = updates.get(delivery.id)!;
      return (
        !delivery.plannedDate ||
        !isDateInPlannedMonth(
          delivery.plannedDate,
          actualDate,
          delivery.scheduleMonth,
        )
      );
    });
    if (invalid) {
      res.status(400).json({
        error:
          "Дата факта должна находиться в том же месяце, что и плановая дата",
      });
      return;
    }

    await db.transaction(async (tx) => {
      for (const delivery of existing) {
        await tx
          .update(deliveriesTable)
          .set({
            actualDate: updates.get(delivery.id)!,
            actApprovedAt: null,
            actApprovedBy: null,
          })
          .where(eq(deliveriesTable.id, delivery.id));
      }
    });

    res.json(
      UpdateDeliveriesActualBulkResponse.parse({ updated: updates.size }),
    );
  },
);

router.post(
  "/deliveries/bulk/replace",
  canEditDeliveries,
  async (req, res): Promise<void> => {
    const parsed = ReplaceDeliveriesBulkBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const itemsOutsideMonth = parsed.data.items.filter((item) => {
      const plannedDate = dateString(item.plannedDate);
      return (
        plannedDate !== null && !plannedDate.startsWith(`${parsed.data.month}-`)
      );
    });
    if (itemsOutsideMonth.length > 0) {
      res
        .status(400)
        .json({
          error: "Все плановые даты должны относиться к выбранному месяцу",
        });
      return;
    }

    const siteIds = [...new Set(parsed.data.items.map((item) => item.siteId))];
    const sites = await db.select().from(sitesTable);
    const siteMap = new Map(sites.map((site) => [site.id, site]));
    const missing = siteIds.filter((id) => !siteMap.has(id));
    if (missing.length > 0) {
      res.status(404).json({ error: `Sites not found: ${missing.join(", ")}` });
      return;
    }
    if (parsed.data.items.some((item) => !item.driverUserId)) {
      res.status(400).json({
        error:
          "В каждой строке графика должен быть указан водитель из справочника пользователей",
      });
      return;
    }
    if (
      (
        await findInvalidDriverUserIds(
          parsed.data.items.map((item) => item.driverUserId),
        )
      ).length > 0
    ) {
      res
        .status(400)
        .json({
          error: "Один или несколько пользователей не являются водителями",
        });
      return;
    }

    const existingDeliveries = await db
      .select({
        id: deliveriesTable.id,
        siteId: deliveriesTable.siteId,
        plannedDate: deliveriesTable.plannedDate,
        actualDate: deliveriesTable.actualDate,
      })
      .from(deliveriesTable)
      .where(monthCondition(parsed.data.month));
    const existingIds = existingDeliveries
      .filter((delivery) => delivery.plannedDate !== null)
      .map((delivery) => delivery.id);
    if (existingDeliveries.some((delivery) => delivery.actualDate !== null)) {
      res.status(409).json({
        error:
          "Полная замена запрещена: в выбранном месяце уже есть фактические даты",
      });
      return;
    }
    const photos =
      existingIds.length > 0
        ? await db
            .select({ objectPath: deliveryPhotosTable.objectPath })
            .from(deliveryPhotosTable)
            .where(inArray(deliveryPhotosTable.deliveryId, existingIds))
        : [];
    const preservedUndatedSites = new Set(
      existingDeliveries
        .filter((delivery) => delivery.plannedDate === null)
        .map((delivery) => delivery.siteId),
    );
    const incomingKeys = new Set<string>();
    const itemsToInsert = parsed.data.items.filter((item) => {
      const plannedDate = dateString(item.plannedDate);
      const key = `${item.siteId}:${parsed.data.month}:${plannedDate ?? "undated"}`;
      if (incomingKeys.has(key)) return false;
      incomingKeys.add(key);
      if (plannedDate !== null) return true;
      if (preservedUndatedSites.has(item.siteId)) return false;
      return true;
    });

    const inserted = await db.transaction(async (tx) => {
      if (existingIds.length > 0) {
        await tx
          .delete(deliveriesTable)
          .where(inArray(deliveriesTable.id, existingIds));
      }
      if (itemsToInsert.length === 0) return [];
      return tx
        .insert(deliveriesTable)
        .values(
          itemsToInsert.map((item) => ({
            siteId: item.siteId,
            driverUserId: item.driverUserId ?? null,
            plannedDate: dateString(item.plannedDate),
            scheduleMonth: parsed.data.month,
            note: item.note ?? null,
          })),
        )
        .returning();
    });

    await Promise.allSettled(
      photos.map(async ({ objectPath }) => {
        const objectFile =
          await objectStorageService.getObjectEntityFile(objectPath);
        await objectFile.delete();
      }),
    );

    const dtos = await Promise.all(
      inserted.map(async (row) =>
        toDeliveryDto(
          row,
          siteMap.get(row.siteId)!.name,
          siteMap.get(row.siteId)!.address,
          0,
          await getDriverName(row.driverUserId),
        ),
      ),
    );
    res.status(201).json(ReplaceDeliveriesBulkResponse.parse(dtos));
  },
);

router.patch(
  "/deliveries/:id",
  canEditDeliveries,
  async (req, res): Promise<void> => {
    const params = UpdateDeliveryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const parsed = UpdateDeliveryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const updateValues: Record<string, unknown> = {};
    if (
      parsed.data.driverUserId !== undefined &&
      (await findInvalidDriverUserIds([parsed.data.driverUserId])).length > 0
    ) {
      res
        .status(400)
        .json({ error: "Выбранный пользователь не является водителем" });
      return;
    }
    let existing: typeof deliveriesTable.$inferSelect | undefined;
    if (
      parsed.data.actualDate !== undefined ||
      parsed.data.plannedDate !== undefined
    ) {
      [existing] = await db
        .select()
        .from(deliveriesTable)
        .where(eq(deliveriesTable.id, params.data.id));
      if (!existing) {
        res.status(404).json({ error: "Доставка не найдена" });
        return;
      }
    }
    if (parsed.data.plannedDate !== undefined) {
      const plannedDate = dateString(parsed.data.plannedDate);
      if (!plannedDate && (existing!.actualDate || existing!.actApprovedAt)) {
        res
          .status(409)
          .json({
            error: "Нельзя убрать дату у выполненной или закрытой доставки",
          });
        return;
      }
      const ownerMonth = effectiveMonth(
        existing!.plannedDate,
        existing!.scheduleMonth,
      );
      if (!ownerMonth) {
        res
          .status(400)
          .json({ error: "Невозможно определить месяц графика доставки" });
        return;
      }
      if (plannedDate && plannedDate.slice(0, 7) !== ownerMonth) {
        res
          .status(400)
          .json({ error: "Плановая дата должна относиться к месяцу графика" });
        return;
      }
      updateValues.plannedDate = plannedDate;
      if (!plannedDate && !existing!.scheduleMonth) {
        updateValues.scheduleMonth = ownerMonth;
      }
    }
    if (parsed.data.actualDate !== undefined) {
      const actualDate = parsed.data.actualDate
        ? parsed.data.actualDate.toISOString().slice(0, 10)
        : null;
      if (actualDate) {
        const resultingPlannedDate =
          parsed.data.plannedDate !== undefined
            ? dateString(parsed.data.plannedDate)
            : existing!.plannedDate;
        if (!resultingPlannedDate) {
          res
            .status(409)
            .json({ error: "Сначала назначьте плановую дату доставки" });
          return;
        }
        if (
          !isDateInPlannedMonth(
            resultingPlannedDate,
            actualDate,
            existing!.scheduleMonth,
          )
        ) {
          res.status(400).json({
            error:
              "Фактическая дата должна быть в том же месяце, что и плановая",
          });
          return;
        }
      }
      updateValues.actualDate = actualDate;
      updateValues.actApprovedAt = null;
      updateValues.actApprovedBy = null;
    }
    if (parsed.data.note !== undefined) updateValues.note = parsed.data.note;
    if (parsed.data.driverUserId !== undefined)
      updateValues.driverUserId = parsed.data.driverUserId;

    let delivery: typeof deliveriesTable.$inferSelect | undefined;
    try {
      [delivery] = await db
        .update(deliveriesTable)
        .set(updateValues)
        .where(eq(deliveriesTable.id, params.data.id))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "Такая строка графика уже существует" });
        return;
      }
      throw error;
    }

    if (!delivery) {
      res.status(404).json({ error: "Delivery not found" });
      return;
    }

    const [site] = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.id, delivery.siteId));
    const counts = await photosCountMap([delivery.id]);

    res.json(
      UpdateDeliveryResponse.parse(
        toDeliveryDto(
          delivery,
          site?.name ?? "",
          site?.address ?? "",
          counts.get(delivery.id) ?? 0,
          await getDriverName(delivery.driverUserId),
        ),
      ),
    );
  },
);

router.post(
  "/deliveries/:id/reschedule",
  canEditDeliveries,
  async (req, res): Promise<void> => {
    const params = RescheduleDeliveryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = RescheduleDeliveryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
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
    if (existing.actualDate) {
      res
        .status(400)
        .json({ error: "Доставка уже выполнена — перенос невозможен" });
      return;
    }

    const newDate = parsed.data.newDate.toISOString().slice(0, 10);
    if (newDate === existing.plannedDate) {
      res.status(400).json({ error: "Новая дата совпадает с текущей" });
      return;
    }
    if (
      newDate.slice(0, 7) !==
      effectiveMonth(existing.plannedDate, existing.scheduleMonth)
    ) {
      res
        .status(400)
        .json({ error: "Новая дата должна относиться к месяцу графика" });
      return;
    }

    let delivery: typeof deliveriesTable.$inferSelect;
    try {
      [delivery] = await db
        .update(deliveriesTable)
        .set({
          plannedDate: newDate,
          // Keep the very first planned date across repeated reschedules.
          rescheduledFromDate:
            existing.rescheduledFromDate ?? existing.plannedDate,
          rescheduledBy:
            req.appUser?.name ?? req.appUser?.email ?? "неизвестно",
          rescheduledAt: new Date(),
        })
        .where(eq(deliveriesTable.id, params.data.id))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "Такая строка графика уже существует" });
        return;
      }
      throw error;
    }

    const [site] = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.id, delivery.siteId));
    const counts = await photosCountMap([delivery.id]);
    res.json(
      RescheduleDeliveryResponse.parse(
        toDeliveryDto(
          delivery,
          site?.name ?? "",
          site?.address ?? "",
          counts.get(delivery.id) ?? 0,
          await getDriverName(delivery.driverUserId),
        ),
      ),
    );
  },
);

router.post(
  "/deliveries/:id/approve-act",
  requireDeliveryActApproval,
  async (req, res): Promise<void> => {
    const params = ApproveDeliveryActParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!req.appUser) {
      res.status(403).json({ error: "Пользователь не найден" });
      return;
    }

    const outcome = await db.transaction(async (tx) => {
      const [delivery] = await tx
        .select()
        .from(deliveriesTable)
        .where(eq(deliveriesTable.id, params.data.id))
        .for("update")
        .limit(1);
      if (!delivery) return { status: 404 as const };
      if (!delivery.plannedDate)
        return { status: 409 as const, reason: "undated" as const };
      if (delivery.actApprovedAt) return { status: 200 as const, delivery };
      if (!delivery.actualDate)
        return { status: 409 as const, reason: "done" as const };

      const [photo] = await tx
        .select({ id: deliveryPhotosTable.id })
        .from(deliveryPhotosTable)
        .where(
          and(
            eq(deliveryPhotosTable.deliveryId, delivery.id),
            isNull(deliveryPhotosTable.deletionPendingAt),
          ),
        )
        .limit(1);
      if (!photo) return { status: 409 as const, reason: "photo" as const };

      const [updated] = await tx
        .update(deliveriesTable)
        .set({ actApprovedAt: new Date(), actApprovedBy: req.appUser!.id })
        .where(eq(deliveriesTable.id, delivery.id))
        .returning();
      return { status: 200 as const, delivery: updated };
    });

    if (outcome.status === 404) {
      res.status(404).json({ error: "Доставка не найдена" });
      return;
    }
    if (outcome.status === 409) {
      res.status(409).json({
        error:
          outcome.reason === "done"
            ? "Сначала отметьте доставку выполненной"
            : outcome.reason === "undated"
              ? "Сначала назначьте плановую дату доставки"
              : "Для подтверждения требуется хотя бы один акт",
      });
      return;
    }

    const [site] = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.id, outcome.delivery.siteId));
    const counts = await photosCountMap([outcome.delivery.id]);
    req.log.info(
      { deliveryId: outcome.delivery.id, approvedBy: req.appUser.id },
      "Delivery act approved",
    );
    res.json(
      ApproveDeliveryActResponse.parse(
        toDeliveryDto(
          outcome.delivery,
          site?.name ?? "",
          site?.address ?? "",
          counts.get(outcome.delivery.id) ?? 0,
          await getDriverName(outcome.delivery.driverUserId),
        ),
      ),
    );
  },
);

router.get("/deliveries/:id/photos", async (req, res): Promise<void> => {
  const params = ListDeliveryPhotosParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [delivery] = await db
    .select()
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, params.data.id));
  if (!delivery) {
    res.status(404).json({ error: "Доставка не найдена" });
    return;
  }
  if (!canAccessDeliveryActs(req.appUser, delivery.driverUserId)) {
    res
      .status(403)
      .json({ error: "Нет прав просматривать акты этой доставки" });
    return;
  }

  const rows = await db
    .select()
    .from(deliveryPhotosTable)
    .where(
      and(
        eq(deliveryPhotosTable.deliveryId, params.data.id),
        isNull(deliveryPhotosTable.deletionPendingAt),
      ),
    )
    .orderBy(deliveryPhotosTable.createdAt);

  res.json(ListDeliveryPhotosResponse.parse(rows));
});

// Attach a photo act: allowed for delivery editors OR the driver assigned to this delivery.
router.post("/deliveries/:id/photos", async (req, res): Promise<void> => {
  const params = AddDeliveryPhotoParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [authorizedDelivery] = await db
    .select({ driverUserId: deliveriesTable.driverUserId })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, params.data.id))
    .limit(1);
  if (!authorizedDelivery) {
    res.status(404).json({ error: "Доставка не найдена" });
    return;
  }
  if (!canUploadDeliveryActs(req.appUser, authorizedDelivery.driverUserId)) {
    res
      .status(403)
      .json({ error: "Нет прав прикладывать фото к этой доставке" });
    return;
  }

  const parsed = AddDeliveryPhotoBody.safeParse(req.body);
  if (!parsed.success) {
    const rejectedObjectPath = getRejectedUploadObjectPath(req.body);
    if (rejectedObjectPath) {
      await cleanupRejectedObject(req, rejectedObjectPath);
    }
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!isUploadObjectPath(parsed.data.objectPath)) {
    res.status(400).json({ error: "Некорректный путь файла" });
    return;
  }

  let outcome;
  try {
    outcome = await db.transaction(async (tx) => {
      const [delivery] = await tx
        .select()
        .from(deliveriesTable)
        .where(eq(deliveriesTable.id, params.data.id))
        .for("update")
        .limit(1);
      if (!delivery) {
        return {
          status: 404 as const,
          error: "Доставка не найдена",
          cleanup: false,
        };
      }
      if (delivery.deletionPendingAt) {
        return {
          status: 409 as const,
          error: "Доставка уже удаляется",
          cleanup: true,
        };
      }
      if (!delivery.actualDate) {
        return {
          status: 400 as const,
          error: "Сначала подтвердите фактическую дату доставки",
          cleanup: true,
        };
      }
      if (!canUploadDeliveryActs(req.appUser, delivery.driverUserId)) {
        return {
          status: 403 as const,
          error: "Нет прав прикладывать фото к этой доставке",
          cleanup: false,
        };
      }
      if (delivery.actApprovedAt && !userCanEditDeliveries(req)) {
        return {
          status: 409 as const,
          error: "Закрытая доставка недоступна для изменения водителем",
          cleanup: true,
        };
      }

      await acquireDeliveryUploadLock(tx, parsed.data.objectPath);
      const [alreadyAttached] = await tx
        .select({ id: deliveryPhotosTable.id })
        .from(deliveryPhotosTable)
        .where(eq(deliveryPhotosTable.objectPath, parsed.data.objectPath))
        .limit(1);
      if (isDeliveryActAlreadyAttached(alreadyAttached)) {
        return {
          status: 409 as const,
          error: "Этот файл уже прикреплён",
          cleanup: false,
        };
      }

      let actualMimeType: string;
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(
          parsed.data.objectPath,
          false,
        );
        const [metadata] = await objectFile.getMetadata();
        actualMimeType = String(
          metadata.contentType ?? "application/octet-stream",
        );
      } catch {
        return {
          status: 400 as const,
          error: "Загруженный файл не найден",
          cleanup: true,
        };
      }
      if (!isAllowedDeliveryActMimeType(actualMimeType)) {
        return {
          status: 400 as const,
          error: "Разрешены только PDF и изображения",
          cleanup: true,
        };
      }

      const [photo] = await tx
        .insert(deliveryPhotosTable)
        .values({
          deliveryId: delivery.id,
          objectPath: parsed.data.objectPath,
          fileName: parsed.data.fileName,
          mimeType: actualMimeType,
          uploadedBy: req.appUser?.name ?? req.appUser?.email ?? "неизвестно",
        })
        .onConflictDoNothing({ target: deliveryPhotosTable.objectPath })
        .returning();
      if (!photo) {
        return {
          status: 409 as const,
          error: "Этот файл уже прикреплён",
          cleanup: false,
        };
      }

      if (delivery.actApprovedAt) {
        await tx
          .update(deliveriesTable)
          .set({ actApprovedAt: null, actApprovedBy: null })
          .where(eq(deliveriesTable.id, delivery.id));
      }

      return { status: 201 as const, photo, cleanup: false };
    });
  } catch (error) {
    req.log?.error({ err: error }, "Failed to attach delivery act");
    await cleanupRejectedObject(req, parsed.data.objectPath);
    res.status(500).json({ error: "Не удалось прикрепить файл" });
    return;
  }

  if (outcome.status !== 201) {
    if (outcome.cleanup) {
      await cleanupRejectedObject(req, parsed.data.objectPath);
    }
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }

  res.status(201).json(AddDeliveryPhotoResponse.parse(outcome.photo));
});

router.delete(
  "/delivery-photos/:id",
  canEditDeliveries,
  async (req, res): Promise<void> => {
    const params = DeleteDeliveryPhotoParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    try {
      const prepared = await db.transaction(async (tx) => {
        const [photo] = await tx
          .select()
          .from(deliveryPhotosTable)
          .where(eq(deliveryPhotosTable.id, params.data.id))
          .limit(1);
        if (!photo) {
          return { status: 404 as const };
        }

        const [delivery] = await tx
          .select({ id: deliveriesTable.id })
          .from(deliveriesTable)
          .where(eq(deliveriesTable.id, photo.deliveryId))
          .for("update")
          .limit(1);
        if (!delivery) {
          return { status: 404 as const };
        }

        await acquireDeliveryUploadLock(tx, photo.objectPath);
        const [lockedPhoto] = await tx
          .select()
          .from(deliveryPhotosTable)
          .where(eq(deliveryPhotosTable.id, photo.id))
          .for("update")
          .limit(1);
        if (!lockedPhoto) {
          return { status: 404 as const };
        }

        if (!lockedPhoto.deletionPendingAt) {
          await tx
            .update(deliveryPhotosTable)
            .set({ deletionPendingAt: new Date() })
            .where(eq(deliveryPhotosTable.id, lockedPhoto.id));
          await tx
            .update(deliveriesTable)
            .set({ actApprovedAt: null, actApprovedBy: null })
            .where(eq(deliveriesTable.id, lockedPhoto.deliveryId));
        }
        return {
          status: 200 as const,
          id: lockedPhoto.id,
          objectPath: lockedPhoto.objectPath,
        };
      });

      if (prepared.status === 404) {
        res.status(404).json({ error: "Фото не найдено" });
        return;
      }

      const finalized = await db.transaction(async (tx) => {
        await acquireDeliveryUploadLock(tx, prepared.objectPath);
        const [pending] = await tx
          .select({ id: deliveryPhotosTable.id })
          .from(deliveryPhotosTable)
          .where(
            and(
              eq(deliveryPhotosTable.id, prepared.id),
              isNotNull(deliveryPhotosTable.deletionPendingAt),
            ),
          )
          .for("update")
          .limit(1);
        if (!pending) return { status: 204 as const };

        if (!(await deleteAttachedObject(req, prepared.objectPath))) {
          return { status: 502 as const };
        }

        await tx
          .delete(deliveryPhotosTable)
          .where(
            and(
              eq(deliveryPhotosTable.id, prepared.id),
              isNotNull(deliveryPhotosTable.deletionPendingAt),
            ),
          );
        return { status: 204 as const };
      });

      if (finalized.status === 502) {
        res.status(502).json({ error: "Не удалось удалить файл акта" });
        return;
      }
    } catch (error) {
      req.log?.error({ err: error }, "Failed to delete delivery act");
      res.status(500).json({ error: "Не удалось удалить акт" });
      return;
    }

    res.sendStatus(204);
  },
);

router.delete(
  "/deliveries/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = DeleteDeliveryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    try {
      const prepared = await db.transaction(async (tx) => {
        const [delivery] = await tx
          .select()
          .from(deliveriesTable)
          .where(eq(deliveriesTable.id, params.data.id))
          .for("update")
          .limit(1);
        if (!delivery) {
          return { status: 404 as const };
        }

        const photos = await tx
          .select({
            id: deliveryPhotosTable.id,
            objectPath: deliveryPhotosTable.objectPath,
          })
          .from(deliveryPhotosTable)
          .where(eq(deliveryPhotosTable.deliveryId, delivery.id))
          .orderBy(deliveryPhotosTable.objectPath);
        for (const photo of photos) {
          await acquireDeliveryUploadLock(tx, photo.objectPath);
        }
        const pendingAt = delivery.deletionPendingAt ?? new Date();
        if (!delivery.deletionPendingAt) {
          await tx
            .update(deliveriesTable)
            .set({ deletionPendingAt: pendingAt })
            .where(eq(deliveriesTable.id, delivery.id));
        }
        if (photos.length > 0) {
          await tx
            .update(deliveryPhotosTable)
            .set({ deletionPendingAt: pendingAt })
            .where(eq(deliveryPhotosTable.deliveryId, delivery.id));
        }
        return { status: 200 as const, deliveryId: delivery.id };
      });

      if (prepared.status === 404) {
        res.status(404).json({ error: "Delivery not found" });
        return;
      }

      const outcome = await db.transaction(async (tx) => {
        const [delivery] = await tx
          .select({ id: deliveriesTable.id })
          .from(deliveriesTable)
          .where(
            and(
              eq(deliveriesTable.id, prepared.deliveryId),
              isNotNull(deliveriesTable.deletionPendingAt),
            ),
          )
          .for("update")
          .limit(1);
        if (!delivery) return { status: 204 as const };

        const photos = await tx
          .select({
            id: deliveryPhotosTable.id,
            objectPath: deliveryPhotosTable.objectPath,
          })
          .from(deliveryPhotosTable)
          .where(eq(deliveryPhotosTable.deliveryId, delivery.id))
          .orderBy(deliveryPhotosTable.objectPath);
        for (const photo of photos) {
          await acquireDeliveryUploadLock(tx, photo.objectPath);
          if (!(await deleteAttachedObject(req, photo.objectPath))) {
            return { status: 502 as const };
          }
        }

        await tx
          .delete(deliveriesTable)
          .where(eq(deliveriesTable.id, delivery.id));
        return { status: 204 as const };
      });

      if (outcome.status === 502) {
        res.status(502).json({ error: "Не удалось удалить файлы актов" });
        return;
      }
    } catch (error) {
      req.log?.error({ err: error }, "Failed to delete delivery");
      res.status(500).json({ error: "Не удалось удалить доставку" });
      return;
    }

    res.sendStatus(204);
  },
);

export default router;
