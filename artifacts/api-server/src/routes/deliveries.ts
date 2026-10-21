import { Router, type IRouter } from "express";
import { Readable } from "node:stream";
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
  deliveryTypesTable,
  sitesTable,
  appUsersTable,
  clientsTable,
  ordersTable,
  orderItemsTable,
  productsTable,
} from "@workspace/db";
import {
  ListDeliveriesQueryParams,
  CreateDeliveryBody,
  CreateDeliveriesBulkBody,
  ReplaceDeliveriesBulkBody,
  UpdateDeliveriesActualBulkBody,
  UpdateDeliveriesBulkBody,
  UpdateDeliveryParams,
  UpdateDeliveryBody,
  DeleteDeliveryParams,
  ListDeliveriesResponse,
  CreateDeliveryResponse,
  CreateDeliveriesBulkResponse,
  ReplaceDeliveriesBulkResponse,
  UpdateDeliveriesActualBulkResponse,
  UpdateDeliveriesBulkResponse,
  UpdateDeliveryResponse,
  RescheduleDeliveryParams,
  RescheduleDeliveryBody,
  RescheduleDeliveryResponse,
  ApproveDeliveryActParams,
  ApproveDeliveryActResponse,
  RestoreDeliveryParams,
  RestoreDeliveryResponse,
  ListDeliveryPhotosParams,
  ListDeliveryPhotosResponse,
  AddDeliveryPhotoParams,
  AddDeliveryPhotoBody,
  AddDeliveryPhotoResponse,
  UpdateDeliveryPhotoCaptionParams,
  UpdateDeliveryPhotoCaptionBody,
  UpdateDeliveryPhotoCaptionResponse,
  DeleteDeliveryPhotoParams,
  ListDeliverySiteLookupResponse,
  ListDeliveryTypeLookupResponse,
  CreateAdditionalDeliveryOrderParams,
  CreateAdditionalDeliveryOrderBody,
  CreateAdditionalDeliveryOrderResponse,
} from "@workspace/api-zod";
import {
  toDeliveryDto,
  monthRange,
  photosCountMap,
  deliveryDtoEnrichmentMap,
  todayLocalISO,
} from "../lib/deliveries";
import { isPostgresConstraintError } from "../lib/postgres-errors";
import {
  requireAdmin,
  requireDeliveryActApproval,
  requirePermission,
  requireSectionAccess,
} from "../middlewares/requirePermission";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  canAccessDeliveryActs,
  canApproveDeliveryActs,
  canEditDeliveries as canUserEditDeliveries,
  canUploadDeliveryActs,
  isAllowedDeliveryActMimeType,
  isDateInPlannedMonth,
  isDeliveryActAlreadyAttached,
  isUploadObjectPath,
} from "../lib/delivery-acts";
import {
  MAX_DELIVERY_ACT_FILES,
  isRealIsoDate,
  preflightDeliveryActObjects,
  streamDeliveryActsZip,
  validateDeliveryActDateRange,
  type DeliveryActArchiveItem,
} from "../lib/delivery-act-download";
import { findInvalidDriverUserIds } from "../lib/drivers";
import { isDriverUser, isLogisticianRole } from "../lib/user-roles";
import { INVALID_MONTH_MESSAGE, isValidMonth } from "../lib/calendar-month";
import { acquireDeliveryUploadLock } from "../lib/delivery-upload-lock";
import { createStorageFailureLogFields } from "../lib/storage-log-sanitizer";
import { deliveryHasFrozenOrder, BILLED_ORDER_ERROR } from "../lib/order-billing";
import { BillingError } from "../lib/order-summaries";

const router: IRouter = Router();
const canEditDeliveries = requirePermission("deliveries");
const objectStorageService = new ObjectStorageService();

function canViewArchivedDeliveries(
  req: Parameters<typeof canEditDeliveries>[0],
): boolean {
  return canUserEditDeliveries(req.appUser);
}

function archivedCondition(
  archived: boolean,
) {
  return archived
    ? isNotNull(deliveriesTable.archivedAt)
    : isNull(deliveriesTable.archivedAt);
}

function zipDownloadHeaders(fileName: string) {
  return {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="delivery-acts.zip"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

function sendArchiveError(
  req: Parameters<typeof canEditDeliveries>[0],
  res: Parameters<typeof canEditDeliveries>[1],
  status: number,
  message: string,
): void {
  if (req.method === "HEAD") {
    res
      .status(status)
      .set("X-Download-Error", encodeURIComponent(message))
      .set("Cache-Control", "no-store")
      .end();
    return;
  }
  for (const header of [
    "Content-Disposition",
    "Content-Type",
    "Content-Length",
    "Transfer-Encoding",
  ]) {
    res.removeHeader(header);
  }
  res
    .status(status)
    .set("Cache-Control", "no-store")
    .set("X-Content-Type-Options", "nosniff")
    .json({ error: message });
}

async function sendActsArchive(
  req: Parameters<typeof canEditDeliveries>[0],
  res: Parameters<typeof canEditDeliveries>[1],
  items: DeliveryActArchiveItem[],
  fileName: string,
): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once("aborted", abort);
  res.once("close", abort);
  try {
    res.set(zipDownloadHeaders(fileName));
    await streamDeliveryActsZip(
      items,
      res,
      async (item, signal) => {
        if (signal.aborted)
          throw new DOMException("Download aborted", "AbortError");
        const file = await objectStorageService.getObjectEntityFile(
          item.objectPath,
        );
        if (signal.aborted)
          throw new DOMException("Download aborted", "AbortError");
        const response = await objectStorageService.downloadObject(file, 0);
        if (!response.body) throw new Error("Object download returned no body");
        const stream = Readable.fromWeb(
          response.body as import("node:stream/web").ReadableStream,
        );
        if (signal.aborted) {
          stream.destroy();
          throw new DOMException("Download aborted", "AbortError");
        }
        return stream;
      },
      controller.signal,
    );
  } catch (error) {
    if (!controller.signal.aborted) {
      req.log?.error(
        {
          operation: "download-delivery-acts",
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Failed to stream delivery acts archive",
      );
      if (res.headersSent) res.destroy();
      else
        sendArchiveError(req, res, 502, "Не удалось сформировать архив актов");
    }
  } finally {
    req.removeListener("aborted", abort);
    res.removeListener("close", abort);
  }
}

async function preflightActs(
  req: Parameters<typeof canEditDeliveries>[0],
  res: Parameters<typeof canEditDeliveries>[1],
  items: DeliveryActArchiveItem[],
): Promise<boolean> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once("aborted", abort);
  res.once("close", abort);
  try {
    await preflightDeliveryActObjects(
      items,
      async (item, signal) => {
        if (signal.aborted)
          throw new DOMException("Download aborted", "AbortError");
        await objectStorageService.getObjectEntityFile(item.objectPath);
        if (signal.aborted)
          throw new DOMException("Download aborted", "AbortError");
      },
      controller.signal,
    );
    return true;
  } catch {
    return false;
  } finally {
    req.removeListener("aborted", abort);
    res.removeListener("close", abort);
  }
}

router.get("/deliveries/acts/download", async (req, res): Promise<void> => {
  if (!canApproveDeliveryActs(req.appUser)) {
    sendArchiveError(req, res, 403, "Нет прав выгружать акты за период");
    return;
  }
  const range = validateDeliveryActDateRange(req.query.from, req.query.to);
  if (!range.success) {
    sendArchiveError(req, res, 400, range.error);
    return;
  }
  const rows = await db
    .select({
      objectPath: deliveryPhotosTable.objectPath,
      fileName: deliveryPhotosTable.fileName,
      actualDate: deliveriesTable.actualDate,
      siteName: sitesTable.name,
    })
    .from(deliveryPhotosTable)
    .innerJoin(
      deliveriesTable,
      eq(deliveryPhotosTable.deliveryId, deliveriesTable.id),
    )
    .innerJoin(sitesTable, eq(deliveriesTable.siteId, sitesTable.id))
    .where(
      and(
        gte(deliveriesTable.actualDate, range.from),
        lte(deliveriesTable.actualDate, range.to),
        isNull(deliveriesTable.archivedAt),
        isNull(deliveriesTable.deletionPendingAt),
        isNull(deliveryPhotosTable.deletionPendingAt),
      ),
    )
    .orderBy(
      deliveriesTable.actualDate,
      deliveriesTable.id,
      deliveryPhotosTable.createdAt,
      deliveryPhotosTable.id,
    )
    .limit(MAX_DELIVERY_ACT_FILES + 1);
  if (rows.length === 0) {
    sendArchiveError(req, res, 404, "За выбранный период акты не найдены");
    return;
  }
  if (rows.length > MAX_DELIVERY_ACT_FILES) {
    sendArchiveError(
      req,
      res,
      413,
      "В архиве больше 2000 актов. Сократите период",
    );
    return;
  }
  if (req.method === "HEAD") {
    if (!(await preflightActs(req, res, rows))) {
      sendArchiveError(req, res, 502, "Не удалось подготовить архив актов");
      return;
    }
    res
      .status(200)
      .set(zipDownloadHeaders(`акты-${range.from}-${range.to}.zip`))
      .end();
    return;
  }
  await sendActsArchive(req, res, rows, `акты-${range.from}-${range.to}.zip`);
});

router.get("/deliveries/:id/acts/download", async (req, res): Promise<void> => {
  const params = ListDeliveryPhotosParams.safeParse(req.params);
  if (!params.success) {
    sendArchiveError(req, res, 400, params.error.message);
    return;
  }
  const [delivery] = await db
    .select({
      id: deliveriesTable.id,
      driverUserId: deliveriesTable.driverUserId,
      actualDate: deliveriesTable.actualDate,
      siteName: sitesTable.name,
      archivedAt: deliveriesTable.archivedAt,
    })
    .from(deliveriesTable)
    .innerJoin(sitesTable, eq(deliveriesTable.siteId, sitesTable.id))
    .where(
      and(
        eq(deliveriesTable.id, params.data.id),
        isNull(deliveriesTable.deletionPendingAt),
      ),
    )
    .limit(1);
  if (!delivery) {
    sendArchiveError(req, res, 404, "Доставка не найдена");
    return;
  }
   if (
     delivery.archivedAt
       ? !canUserEditDeliveries(req.appUser)
       : !canAccessDeliveryActs(req.appUser, delivery.driverUserId)
   ) {
    sendArchiveError(
      req,
      res,
      403,
      "Нет прав просматривать акты этой доставки",
    );
    return;
  }
  const photos = await db
    .select({
      objectPath: deliveryPhotosTable.objectPath,
      fileName: deliveryPhotosTable.fileName,
    })
    .from(deliveryPhotosTable)
    .where(
      and(
        eq(deliveryPhotosTable.deliveryId, delivery.id),
        isNull(deliveryPhotosTable.deletionPendingAt),
      ),
    )
    .orderBy(deliveryPhotosTable.createdAt, deliveryPhotosTable.id)
    .limit(MAX_DELIVERY_ACT_FILES + 1);
  if (photos.length === 0) {
    sendArchiveError(req, res, 404, "У доставки нет актов");
    return;
  }
  if (photos.length > MAX_DELIVERY_ACT_FILES) {
    sendArchiveError(req, res, 413, "В архиве больше 2000 актов");
    return;
  }
  if (req.method === "HEAD") {
    const items = photos.map((photo) => ({
      ...photo,
      actualDate: delivery.actualDate,
      siteName: delivery.siteName,
    }));
    if (!(await preflightActs(req, res, items))) {
      sendArchiveError(req, res, 502, "Не удалось подготовить архив актов");
      return;
    }
    res
      .status(200)
      .set(zipDownloadHeaders(`акты-доставки-${delivery.id}.zip`))
      .end();
    return;
  }
  const items = photos.map((photo) => ({
    ...photo,
    actualDate: delivery.actualDate,
    siteName: delivery.siteName,
  }));
  await sendActsArchive(req, res, items, `акты-доставки-${delivery.id}.zip`);
});

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
        managerContact: sitesTable.managerContact,
        deliveryType: sitesTable.deliveryType,
        serviceMode: sitesTable.serviceMode,
        features: sitesTable.features,
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
          managerContact: row.managerContact ?? "",
          deliveryType: row.deliveryType ?? "",
          serviceMode: row.serviceMode ?? (/^доп[.\s]*заказ/i.test(row.deliveryType.trim()) ? "additional_only" : "monthly"),
          features: row.features ?? "",
          client: row.client ?? "",
          driver: row.driverUserId
            ? (driverNames.get(row.driverUserId) ?? "Не назначен")
            : "Не назначен",
        })),
      ),
    );
  },
);

router.get(
  "/deliveries/type-lookup",
  requireSectionAccess("deliveries"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(deliveryTypesTable)
      .orderBy(deliveryTypesTable.name);
    res.json(ListDeliveryTypeLookupResponse.parse(rows));
  },
);

function dateString(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function hasInvalidCreateDate(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  return ["plannedDate", "actualDate", "correctedPlannedDate"].some((field) => {
    const date = (value as Record<string, unknown>)[field];
    return (
      date !== undefined &&
      date !== null &&
      (typeof date !== "string" || !isRealIsoDate(date))
    );
  });
}

function hasInvalidCreateDates(body: unknown, bulk: boolean): boolean {
  if (!bulk) return hasInvalidCreateDate(body);
  if (
    typeof body !== "object" ||
    body === null ||
    !Array.isArray((body as { items?: unknown }).items)
  ) {
    return false;
  }
  return (body as { items: unknown[] }).items.some(hasInvalidCreateDate);
}

async function findUnknownDeliveryTypes(
  values: Array<string | null | undefined>,
): Promise<string[]> {
  const requested = [
    ...new Set(
      values
        .filter(
          (value): value is string => value !== null && value !== undefined,
        )
        .map((value) => value.trim()),
    ),
  ];
  if (requested.length === 0) return [];
  const existing = await db
    .select({ name: deliveryTypesTable.name })
    .from(deliveryTypesTable)
    .where(inArray(deliveryTypesTable.name, requested));
  const existingNames = new Set(existing.map((row) => row.name));
  return requested.filter((name) => !existingNames.has(name));
}

function deliveryTypeError(unknown: string[]): string {
  return `Неизвестный тип поставки: ${unknown.join(", ")}`;
}

function createDatesError(
  plannedDate: string | null,
  actualDate: string | null,
  correctedPlannedDate: string | null,
  scheduleMonth: string | null,
): string | null {
  if (actualDate && !plannedDate) {
    return "Сначала назначьте плановую дату доставки";
  }
  if (
    actualDate &&
    plannedDate &&
    !isDateInPlannedMonth(plannedDate, actualDate, scheduleMonth)
  ) {
    return "Фактическая дата должна быть в том же месяце, что и плановая";
  }
  if (correctedPlannedDate && !plannedDate) {
    return "Сначала назначьте исходную плановую дату доставки";
  }
  return null;
}

function effectiveMonth(
  plannedDate: string | null,
  scheduleMonth: string | null,
): string | null {
  return scheduleMonth ?? plannedDate?.slice(0, 7) ?? null;
}

const DELIVERY_UNIQUE_CONSTRAINTS = new Set([
  "deliveries_owned_dated_uq",
  "deliveries_owned_undated_uq",
  "deliveries_owned_dated_active_uq",
  "deliveries_owned_undated_active_uq",
  "deliveries_primary_dated_active_uq",
  "deliveries_primary_undated_active_uq",
]);

export function isDeliveryScheduleUniqueViolation(error: unknown): boolean {
  return [...DELIVERY_UNIQUE_CONSTRAINTS].some((constraint) =>
    isPostgresConstraintError(error, { code: "23505", constraint }),
  );
}

function isDeliveryDriverForeignKeyViolation(error: unknown): boolean {
  return isPostgresConstraintError(error, {
    code: "23503",
    constraint: "deliveries_driver_user_id_app_users_id_fk",
  });
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
      createStorageFailureLogFields({
        operation: "delete-rejected-delivery-act",
        error,
        objectPath,
      }),
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
      createStorageFailureLogFields({
        operation: "delete-delivery-act-object",
        error,
        objectPath,
      }),
      "Failed to delete delivery act object",
    );
    return false;
  }
}

router.get(
  "/deliveries",
  requireSectionAccess("deliveries"),
  async (req, res): Promise<void> => {
    if (req.query.month !== undefined && !isValidMonth(req.query.month)) {
      res.status(400).json({ error: INVALID_MONTH_MESSAGE });
      return;
    }
    for (const field of ["dateFrom", "dateTo"] as const) {
      const value = req.query[field];
      if (
        value !== undefined &&
        (typeof value !== "string" || !isRealIsoDate(value))
      ) {
        res.status(400).json({
          error: `Дата ${field} должна быть корректной календарной датой в формате YYYY-MM-DD`,
        });
        return;
      }
    }
    const query = ListDeliveriesQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }
    // Do not rely on z.coerce.boolean here: Boolean("false") is true.
    // The wire contract treats an omitted value and explicit false identically.
    const archived = req.query.archived === "true";
    if (archived && !canViewArchivedDeliveries(req)) {
      res.status(403).json({ error: "Нет прав просматривать архив доставок" });
      return;
    }

    const conditions = [];
    conditions.push(archivedCondition(archived));
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
        clientId: sitesTable.clientId,
        clientName: sitesTable.client,
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
    const enrichment = await deliveryDtoEnrichmentMap(
      rows.map((row) => row.delivery.id),
    );
    let dtos = rows.map((row) =>
      toDeliveryDto(
        row.delivery,
        row.siteName,
        row.siteAddress,
        counts.get(row.delivery.id) ?? 0,
        row.driverName || row.driverEmail || "Не назначен",
        null,
        {
          ...(enrichment.get(row.delivery.id) ?? {}),
          clientId: row.clientId,
          clientName: row.clientName,
        },
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
    if (hasInvalidCreateDates(req.body, false)) {
      res.status(400).json({
        error: "Даты должны быть корректными датами в формате YYYY-MM-DD",
      });
      return;
    }
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
    const actualDate = dateString(parsed.data.actualDate);
    const correctedPlannedDate = dateString(parsed.data.correctedPlannedDate);
    const scheduleMonth =
      parsed.data.scheduleMonth ?? plannedDate?.slice(0, 7) ?? null;
    if (!scheduleMonth) {
      res.status(400).json({
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
    const datesError = createDatesError(
      plannedDate,
      actualDate,
      correctedPlannedDate,
      scheduleMonth,
    );
    if (datesError) {
      res
        .status(
          (actualDate && !plannedDate) || (correctedPlannedDate && !plannedDate)
            ? 409
            : 400,
        )
        .json({ error: datesError });
      return;
    }
    const unknownTypes = await findUnknownDeliveryTypes([
      parsed.data.deliveryType,
    ]);
    if (unknownTypes.length > 0) {
      res.status(400).json({ error: deliveryTypeError(unknownTypes) });
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
          correctedPlannedDate,
          actualDate,
          deliveryType: parsed.data.deliveryType?.trim() ?? null,
          scheduleMonth,
        })
        .returning();
    } catch (error) {
      if (isDeliveryDriverForeignKeyViolation(error)) {
        res
          .status(400)
          .json({ error: "Выбранный пользователь не является водителем" });
        return;
      }
      if (isDeliveryScheduleUniqueViolation(error)) {
        res.status(409).json({ error: "Такая строка графика уже существует" });
        return;
      }
      throw error;
    }

    const enrichment = await deliveryDtoEnrichmentMap([delivery.id]);
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
            null,
            {
              ...(enrichment.get(delivery.id) ?? {}),
              clientId: site.clientId,
              clientName: site.client,
            },
          ),
        ),
      );
  },
);

function normalizedOrderItems(
  items: Array<{ productId: string; quantity: number }>,
): string {
  return [...new Map(
    items.map((item) => [
      item.productId,
      (Number(
        items
          .filter((candidate) => candidate.productId === item.productId)
          .reduce((sum, candidate) => sum + candidate.quantity, 0),
      )).toFixed(6),
    ]),
  )]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([productId, quantity]) => `${productId}:${quantity}`)
    .join("|");
}

router.post(
  "/deliveries/:id/additional-order",
  canEditDeliveries,
  async (req, res): Promise<void> => {
    const params = CreateAdditionalDeliveryOrderParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = CreateAdditionalDeliveryOrderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // Read the routing keys without locks first. The transaction then locks
    // client -> site -> delivery, matching the site/client mutation order and
    // rechecks every value before creating either row.
    const [initialSource] = await db
      .select({ siteId: deliveriesTable.siteId })
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, params.data.id))
      .limit(1);
    if (!initialSource) {
      res.status(404).json({ error: "Доставка не найдена" });
      return;
    }
    const [initialSite] = await db
      .select({ id: sitesTable.id, clientId: sitesTable.clientId })
      .from(sitesTable)
      .where(eq(sitesTable.id, initialSource.siteId))
      .limit(1);
    if (!initialSite) {
      res.status(404).json({ error: "Объект доставки не найден" });
      return;
    }

    let outcome;
    try {
      outcome = await db.transaction(async (tx) => {
      const [client] = await tx
        .select({ id: clientsTable.id })
        .from(clientsTable)
        .where(eq(clientsTable.id, initialSite.clientId))
        .for("update")
        .limit(1);
      if (!client) return { status: 409 as const, reason: "client" as const };

      const [site] = await tx
        .select()
        .from(sitesTable)
        .where(eq(sitesTable.id, initialSite.id))
        .for("update")
        .limit(1);
      if (!site) return { status: 404 as const, reason: "site" as const };
      if (site.clientId !== initialSite.clientId) {
        return { status: 409 as const, reason: "site-changed" as const };
      }

      const [source] = await tx
        .select()
        .from(deliveriesTable)
        .where(eq(deliveriesTable.id, params.data.id))
        .for("update")
        .limit(1);
      if (!source) return { status: 404 as const, reason: "source" as const };
      if (source.parentDeliveryId || source.orderId) {
        return { status: 409 as const, reason: "not-primary" as const };
      }
      if (source.archivedAt) {
        return { status: 409 as const, reason: "archived" as const };
      }
      if (source.deletionPendingAt) {
        return { status: 409 as const, reason: "deleting" as const };
      }
      if (source.siteId !== site.id) {
        return { status: 409 as const, reason: "site-changed" as const };
      }
      if (site.closedFrom) {
        return { status: 409 as const, reason: "site-closed" as const };
      }

      if (
        source.driverUserId &&
        (await findInvalidDriverUserIds([source.driverUserId], tx)).length > 0
      ) {
        return { status: 409 as const, reason: "driver" as const };
      }

      const deliveryType = parsed.data.deliveryType.trim();
      const standardService = ["закрытие", "открывашка", "отмывка"].includes(deliveryType.toLocaleLowerCase("ru"));
      if (standardService ? parsed.data.items.length !== 0 : parsed.data.items.length === 0) {
        return { status: 400 as const, reason: "items" as const };
      }
      if (!deliveryType) {
        return { status: 400 as const, reason: "delivery-type" as const };
      }
      const [knownType] = await tx
        .select({ name: deliveryTypesTable.name })
        .from(deliveryTypesTable)
        .where(eq(deliveryTypesTable.name, deliveryType))
        .limit(1);
      if (!knownType) {
        return { status: 400 as const, reason: "unknown-delivery-type" as const };
      }

      const [existingRequest] = await tx
        .select()
        .from(deliveriesTable)
        .where(eq(deliveriesTable.id, parsed.data.requestId))
        .for("update")
        .limit(1);
      if (existingRequest) {
        if (
          existingRequest.parentDeliveryId !== source.id ||
          !existingRequest.orderId
        ) {
          return { status: 409 as const, reason: "request-conflict" as const };
        }
        const [existingOrder] = await tx
          .select()
          .from(ordersTable)
          .where(eq(ordersTable.id, existingRequest.orderId))
          .limit(1);
        if (!existingOrder) {
          return { status: 409 as const, reason: "request-conflict" as const };
        }
        const existingItems = await tx
          .select({
            productId: orderItemsTable.productId,
            quantity: orderItemsTable.quantity,
          })
          .from(orderItemsTable)
          .where(eq(orderItemsTable.orderId, existingOrder.id));
        const requestedItems = parsed.data.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        }));
        if (
          existingRequest.deliveryType !== deliveryType ||
          (existingOrder.note ?? null) !== (parsed.data.note ?? null) ||
          normalizedOrderItems(
            existingItems.map((item) => ({
              productId: item.productId,
              quantity: Number(item.quantity),
            })),
          ) !== normalizedOrderItems(requestedItems)
        ) {
          return { status: 409 as const, reason: "request-conflict" as const };
        }
        return {
          status: 200 as const,
          orderId: existingOrder.id,
          deliveryId: existingRequest.id,
        };
      }

      const productIds = [...new Set(parsed.data.items.map((item) => item.productId))];
      const products = productIds.length ? await tx
        .select()
        .from(productsTable)
        .where(inArray(productsTable.id, productIds)) : [];
      const productMap = new Map(products.map((product) => [product.id, product]));
      if (products.length !== productIds.length) {
        return { status: 404 as const, reason: "products" as const };
      }

      const [order] = await tx
        .insert(ordersTable)
        .values({
          clientId: client.id,
          siteId: site.id,
          siteName: site.name,
          siteAddress: site.address,
          isPaid: false,
          note: parsed.data.note ?? null,
        })
        .returning();
      if (parsed.data.items.length) await tx.insert(orderItemsTable).values(
        parsed.data.items.map((item) => ({
          orderId: order.id,
          productId: item.productId,
          quantity: String(item.quantity),
          price: String(productMap.get(item.productId)!.price),
        })),
      );
      const [delivery] = await tx
        .insert(deliveriesTable)
        .values({
          id: parsed.data.requestId,
          siteId: source.siteId,
          parentDeliveryId: source.id,
          orderId: order.id,
          driverUserId: source.driverUserId,
          plannedDate: source.plannedDate,
          correctedPlannedDate: source.correctedPlannedDate,
          deliveryType,
          scheduleMonth: source.scheduleMonth,
          logisticianNote: source.logisticianNote,
        })
        .returning();
      return {
        status: 201 as const,
        orderId: order.id,
        deliveryId: delivery.id,
      };
      });
    } catch (error) {
      if (
        isPostgresConstraintError(error, {
          code: "23505",
          constraint: "deliveries_pkey",
        })
      ) {
        res.status(409).json({
          error: "requestId уже использован для другой дополнительной доставки",
        });
        return;
      }
      throw error;
    }

    if (outcome.status === 404) {
      res
        .status(404)
        .json({ error: outcome.reason === "products" ? "Products not found" : "Доставка не найдена" });
      return;
    }
    if (outcome.status === 400) {
      res.status(400).json({
        error:
          outcome.reason === "unknown-delivery-type"
            ? "Выбранный тип поставки отсутствует в справочнике"
            : outcome.reason === "items"
              ? "Для закрытия, открывашки и отмывки товары не выбираются; для остальных типов добавьте позиции заказа"
            : "Тип дополнительной доставки не может быть пустым",
      });
      return;
    }
    if (outcome.status === 409) {
      const error =
        outcome.reason === "archived"
          ? "Архивная доставка недоступна для изменения"
          : outcome.reason === "deleting"
            ? "Доставка уже подготовлена к физическому удалению"
            : outcome.reason === "not-primary"
              ? "Дополнительный заказ можно создать только из основной доставки"
            : outcome.reason === "site-closed"
              ? "Нельзя создать заказ для отключённого объекта"
              : outcome.reason === "driver"
                ? "Водитель исходной доставки больше не активен"
                : outcome.reason === "request-conflict"
                  ? "requestId уже использован для другой дополнительной доставки"
                  : outcome.reason === "site-changed"
                    ? "Состояние клиента объекта изменилось, повторите отправку"
                    : "Клиент объекта недоступен";
      res.status(409).json({ error });
      return;
    }

    res.status(outcome.status).json(
      CreateAdditionalDeliveryOrderResponse.parse({
        orderId: outcome.orderId,
        deliveryId: outcome.deliveryId,
      }),
    );
  },
);

router.post(
  "/deliveries/bulk",
  requireAdmin,
  async (req, res): Promise<void> => {
    if (hasInvalidCreateDates(req.body, true)) {
      res.status(400).json({
        error: "Даты должны быть корректными датами в формате YYYY-MM-DD",
      });
      return;
    }
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
      res.status(400).json({
        error: "Один или несколько пользователей не являются водителями",
      });
      return;
    }
    const normalizedItems = parsed.data.items.map((item) => {
      const plannedDate = dateString(item.plannedDate);
      return {
        ...item,
        plannedDate,
        actualDate: dateString(item.actualDate),
        correctedPlannedDate: dateString(item.correctedPlannedDate),
        deliveryType: item.deliveryType?.trim() ?? null,
        scheduleMonth: item.scheduleMonth ?? plannedDate?.slice(0, 7) ?? null,
      };
    });
    if (normalizedItems.some((item) => !item.scheduleMonth)) {
      res.status(400).json({
        error: "Для доставки без даты необходимо указать месяц графика",
      });
      return;
    }
    const invalidDates = normalizedItems
      .map((item) =>
        createDatesError(
          item.plannedDate,
          item.actualDate,
          item.correctedPlannedDate,
          item.scheduleMonth,
        ),
      )
      .find((error) => error !== null);
    if (invalidDates) {
      res
        .status(
          normalizedItems.some(
            (item) =>
              !item.plannedDate &&
              (item.actualDate || item.correctedPlannedDate),
          )
            ? 409
            : 400,
        )
        .json({ error: invalidDates });
      return;
    }
    const unknownTypes = await findUnknownDeliveryTypes(
      normalizedItems.map((item) => item.deliveryType),
    );
    if (unknownTypes.length > 0) {
      res.status(400).json({ error: deliveryTypeError(unknownTypes) });
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
      .from(deliveriesTable)
      .where(
        and(
          isNull(deliveriesTable.archivedAt),
          isNull(deliveriesTable.orderId),
        ),
      );
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

    let inserted;
    try {
      inserted = await db
        .insert(deliveriesTable)
        .values(
          newItems.map((item) => ({
            siteId: item.siteId,
            driverUserId: item.driverUserId ?? null,
            plannedDate: item.plannedDate,
            correctedPlannedDate: item.correctedPlannedDate,
            actualDate: item.actualDate,
            deliveryType: item.deliveryType,
            scheduleMonth: item.scheduleMonth!,
          })),
        )
        .returning();
    } catch (error) {
      if (isDeliveryScheduleUniqueViolation(error)) {
        res.status(409).json({
          error: "Конфликт строк графика: слот уже занят другой доставкой",
        });
        return;
      }
      if (isDeliveryDriverForeignKeyViolation(error)) {
        res.status(400).json({
          error: "Один или несколько пользователей не являются водителями",
        });
        return;
      }
      throw error;
    }

    const enrichment = await deliveryDtoEnrichmentMap(
      inserted.map((row) => row.id),
    );
    const dtos = await Promise.all(
      inserted.map(async (row) => {
        const site = siteMap.get(row.siteId)!;
        return toDeliveryDto(
          row,
          site.name,
          site.address,
          0,
          await getDriverName(row.driverUserId),
          null,
          {
            ...(enrichment.get(row.id) ?? {}),
            clientId: site.clientId,
            clientName: site.client,
          },
        );
      }),
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

    const outcome = await db.transaction(async (tx) => {
      // Lock every requested row, including archived rows, before deciding
      // whether it is a valid active import target. This prevents an archive
      // racing the validation from receiving the update below.
      const locked = await tx
        .select({
          id: deliveriesTable.id,
          plannedDate: deliveriesTable.plannedDate,
          scheduleMonth: deliveriesTable.scheduleMonth,
          archivedAt: deliveriesTable.archivedAt,
        })
        .from(deliveriesTable)
        .where(inArray(deliveriesTable.id, [...updates.keys()]))
        .for("update");
      const existing = locked.filter((delivery) => delivery.archivedAt === null);

      if (existing.length !== updates.size) {
        return { status: 404 as const };
      }
      if (existing.some((delivery) => !delivery.plannedDate)) {
        return { status: 409 as const, reason: "undated" as const };
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
      if (invalid) return { status: 400 as const, reason: "month" as const };

      for (const delivery of existing) {
        await tx
          .update(deliveriesTable)
          .set({
            actualDate: updates.get(delivery.id)!,
            actApprovedAt: null,
            actApprovedBy: null,
          })
          .where(
            and(
              eq(deliveriesTable.id, delivery.id),
              isNull(deliveriesTable.archivedAt),
            ),
          );
      }
      return { status: 200 as const };
    });

    if (outcome.status === 404) {
      res.status(404).json({ error: "Одна или несколько доставок не найдены" });
      return;
    }
    if (outcome.status === 409) {
      res
        .status(409)
        .json({ error: "Сначала назначьте плановую дату каждой доставки" });
      return;
    }
    if (outcome.status === 400) {
      res.status(400).json({
        error:
          "Дата факта должна находиться в том же месяце, что и плановая дата",
      });
      return;
    }

    res.json(
      UpdateDeliveriesActualBulkResponse.parse({ updated: updates.size }),
    );
  },
);

router.post(
  "/deliveries/bulk/update",
  canEditDeliveries,
  async (req, res): Promise<void> => {
    const body =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : null;
    const hasDriver = body
      ? Object.prototype.hasOwnProperty.call(body, "driverUserId")
      : false;
    const hasPlannedDate = body
      ? Object.prototype.hasOwnProperty.call(body, "plannedDate")
      : false;
    if (Number(hasDriver) + Number(hasPlannedDate) !== 1) {
      res.status(400).json({
        error:
          "Укажите ровно одно изменение: водителя или плановую дату",
      });
      return;
    }
    const rawSnapshots = Array.isArray(body?.deliveries)
      ? body.deliveries
      : [];
    if (
      (hasPlannedDate &&
        (typeof body?.plannedDate !== "string" ||
          !isRealIsoDate(body.plannedDate))) ||
      rawSnapshots.some(
        (item) =>
          item !== null &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          (item as Record<string, unknown>).expectedPlannedDate !== null &&
          (typeof (item as Record<string, unknown>).expectedPlannedDate !==
            "string" ||
            !isRealIsoDate(
              (item as Record<string, unknown>).expectedPlannedDate as string,
            )),
      )
    ) {
      res.status(400).json({
        error: "Даты должны быть корректными датами в формате YYYY-MM-DD",
      });
      return;
    }

    const parsed = UpdateDeliveriesBulkBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const ids = parsed.data.deliveries.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      res.status(400).json({
        error: "Каждая доставка должна быть указана только один раз",
      });
      return;
    }

    const snapshots = new Map(
      parsed.data.deliveries.map((item) => [
        item.id,
        {
          expectedDriverUserId: item.expectedDriverUserId,
          expectedPlannedDate: item.expectedPlannedDate
            ? item.expectedPlannedDate.toISOString().slice(0, 10)
            : null,
        },
      ]),
    );
    const plannedDate = hasPlannedDate
      ? parsed.data.plannedDate!.toISOString().slice(0, 10)
      : undefined;
    const driverUserId = hasDriver
      ? (parsed.data.driverUserId ?? null)
      : undefined;

    try {
      const outcome = await db.transaction(async (tx) => {
        // Keep the same parent-before-child lock order as user deletion:
        // deleting an app user locks that user before ON DELETE updates the
        // referencing deliveries.
        if (driverUserId) {
          const [driver] = await tx
            .select()
            .from(appUsersTable)
            .where(eq(appUsersTable.id, driverUserId))
            // FOR SHARE also blocks role/isDriver changes, so eligibility
            // cannot change between validation and delivery updates.
            .for("share")
            .limit(1);
          if (!driver || !isDriverUser(driver)) {
            return {
              conflict: "Выбранный пользователь не является активным водителем",
            };
          }
        }

        const locked = await tx
          .select()
          .from(deliveriesTable)
          .where(inArray(deliveriesTable.id, ids))
          .orderBy(deliveriesTable.id)
          .for("update");

        if (locked.length !== ids.length) {
          return { conflict: "Одна или несколько доставок больше не существуют" };
        }
        if (hasPlannedDate) {
          for (const delivery of locked) {
            if (await deliveryHasFrozenOrder(delivery.id, tx)) {
              return { conflict: BILLED_ORDER_ERROR };
            }
          }
        }
        const archived = locked.find((delivery) => delivery.archivedAt);
        if (archived) {
          return { conflict: "Архивная доставка недоступна для изменения" };
        }
        const closed = locked.find((delivery) => delivery.actApprovedAt);
        if (closed) {
          return { conflict: "Закрытая доставка недоступна для изменения" };
        }
        const completed = locked.find((delivery) => delivery.actualDate);
        if (completed) {
          return { conflict: "Выполненная доставка недоступна для изменения" };
        }
        const stale = locked.find((delivery) => {
          const expected = snapshots.get(delivery.id)!;
          return (
            delivery.driverUserId !== expected.expectedDriverUserId ||
            delivery.plannedDate !== expected.expectedPlannedDate
          );
        });
        if (stale) {
          return {
            conflict:
              "Данные доставок изменились после выбора. Обновите список и повторите операцию",
          };
        }

        const assignedSiteIds = req.appUser?.assignedSiteIds;
        if (
          assignedSiteIds !== null &&
          assignedSiteIds !== undefined &&
          locked.some(
            (delivery) => !assignedSiteIds.includes(delivery.siteId),
          )
        ) {
          return { forbidden: "Одна или несколько доставок находятся вне доступных объектов" };
        }

        if (plannedDate !== undefined) {
          const wrongMonth = locked.find(
            (delivery) =>
              plannedDate.slice(0, 7) !==
              effectiveMonth(delivery.plannedDate, delivery.scheduleMonth),
          );
          if (wrongMonth) {
            return {
              conflict:
                "Новая дата должна относиться к месяцу графика каждой доставки",
            };
          }
        }

        const changed = locked.filter((delivery) =>
          plannedDate !== undefined
            ? delivery.plannedDate !== plannedDate
            : delivery.driverUserId !== driverUserId,
        );
        for (const delivery of changed) {
          await tx
            .update(deliveriesTable)
            .set(
              plannedDate !== undefined
                ? {
                    plannedDate,
                    rescheduledFromDate:
                      delivery.rescheduledFromDate ?? delivery.plannedDate,
                    rescheduledBy:
                      req.appUser?.name ??
                      req.appUser?.email ??
                      "неизвестно",
                    rescheduledAt: new Date(),
                  }
                : { driverUserId },
            )
            .where(eq(deliveriesTable.id, delivery.id));
        }
        return { updated: changed.length };
      });

      if ("forbidden" in outcome) {
        res.status(403).json({ error: outcome.forbidden });
        return;
      }
      if ("conflict" in outcome) {
        res.status(409).json({ error: outcome.conflict });
        return;
      }
      res.json(UpdateDeliveriesBulkResponse.parse(outcome));
    } catch (error) {
      if (isDeliveryScheduleUniqueViolation(error)) {
        res.status(409).json({
          error: "Конфликт строк графика: слот уже занят другой доставкой",
        });
        return;
      }
      if (isDeliveryDriverForeignKeyViolation(error)) {
        res.status(409).json({
          error: "Выбранный водитель был удалён. Обновите список и повторите операцию",
        });
        return;
      }
      throw error;
    }
  },
);

router.post(
  "/deliveries/bulk/replace",
  requireAdmin,
  async (req, res): Promise<void> => {
    if (!isValidMonth(req.body?.month)) {
      res.status(400).json({ error: INVALID_MONTH_MESSAGE });
      return;
    }
    if (hasInvalidCreateDates(req.body, true)) {
      res.status(400).json({
        error: "Даты должны быть корректными датами в формате YYYY-MM-DD",
      });
      return;
    }
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
      res.status(400).json({
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
      res.status(400).json({
        error: "Один или несколько пользователей не являются водителями",
      });
      return;
    }
    const normalizedItems = parsed.data.items.map((item) => ({
      ...item,
      plannedDate: dateString(item.plannedDate),
      actualDate: dateString(item.actualDate),
      actualDateProvided: item.actualDate !== undefined,
      correctedPlannedDate: dateString(item.correctedPlannedDate),
      correctedPlannedDateProvided: item.correctedPlannedDate !== undefined,
      deliveryType: item.deliveryType?.trim() ?? null,
      deliveryTypeProvided: item.deliveryType !== undefined,
    }));
    const invalidDates = normalizedItems
      .map((item) =>
        createDatesError(
          item.plannedDate,
          item.actualDate,
          item.correctedPlannedDate,
          parsed.data.month,
        ),
      )
      .find((error) => error !== null);
    if (invalidDates) {
      res
        .status(
          normalizedItems.some(
            (item) =>
              !item.plannedDate &&
              (item.actualDate || item.correctedPlannedDate),
          )
            ? 409
            : 400,
        )
        .json({ error: invalidDates });
      return;
    }
    const unknownTypes = await findUnknownDeliveryTypes(
      normalizedItems.map((item) => item.deliveryType),
    );
    if (unknownTypes.length > 0) {
      res.status(400).json({ error: deliveryTypeError(unknownTypes) });
      return;
    }

    let replacement;
    try {
      replacement = await db.transaction(async (tx) => {
        const existingDeliveries = await tx
          .select({
            id: deliveriesTable.id,
            siteId: deliveriesTable.siteId,
            plannedDate: deliveriesTable.plannedDate,
            actualDate: deliveriesTable.actualDate,
            correctedPlannedDate: deliveriesTable.correctedPlannedDate,
            deliveryType: deliveriesTable.deliveryType,
            archivedAt: deliveriesTable.archivedAt,
          })
          .from(deliveriesTable)
          .where(
            and(
              monthCondition(parsed.data.month),
              isNull(deliveriesTable.archivedAt),
              isNull(deliveriesTable.orderId),
            ),
          )
          .for("update");
        const existingIds = existingDeliveries
          .filter((delivery) => delivery.plannedDate !== null)
          .map((delivery) => delivery.id);
        for (const delivery of existingDeliveries) {
          if (await deliveryHasFrozenOrder(delivery.id, tx)) throw new BillingError(409, BILLED_ORDER_ERROR);
        }
        if (existingDeliveries.some((delivery) => delivery.actualDate !== null)) {
          return { kind: "actual" as const };
        }
        const preservedUndatedSites = new Set(
          existingDeliveries
            .filter((delivery) => delivery.plannedDate === null)
            .map((delivery) => delivery.siteId),
        );
        const existingByKey = new Map(
          existingDeliveries.map((delivery) => [
            `${delivery.siteId}:${parsed.data.month}:${delivery.plannedDate ?? "undated"}`,
            delivery,
          ]),
        );
        const incomingKeys = new Set<string>();
        const preservedUndatedUpdates: Array<{
          existingId: string;
          actualDate: string | null;
          actualDateProvided: boolean;
          correctedPlannedDate: string | null;
          correctedPlannedDateProvided: boolean;
          deliveryType: string | null;
          deliveryTypeProvided: boolean;
        }> = [];
        const itemsToInsert = normalizedItems.filter((item) => {
          const key = `${item.siteId}:${parsed.data.month}:${item.plannedDate ?? "undated"}`;
          if (incomingKeys.has(key)) return false;
          incomingKeys.add(key);
          if (item.plannedDate !== null) return true;
          if (preservedUndatedSites.has(item.siteId)) {
            const existing = existingByKey.get(key);
            if (
              existing &&
              (item.actualDateProvided ||
                item.correctedPlannedDateProvided ||
                item.deliveryTypeProvided)
            ) {
              preservedUndatedUpdates.push({
                existingId: existing.id,
                actualDate: item.actualDate,
                actualDateProvided: item.actualDateProvided,
                correctedPlannedDate: item.correctedPlannedDate,
                correctedPlannedDateProvided: item.correctedPlannedDateProvided,
                deliveryType: item.deliveryType,
                deliveryTypeProvided: item.deliveryTypeProvided,
              });
            }
            return false;
          }
          return true;
        });

      for (const item of preservedUndatedUpdates) {
        const updateValues: {
          actualDate?: string | null;
          correctedPlannedDate?: string | null;
          deliveryType?: string | null;
        } = {};
        if (item.actualDateProvided) updateValues.actualDate = item.actualDate;
        if (item.correctedPlannedDateProvided) {
          updateValues.correctedPlannedDate = item.correctedPlannedDate;
        }
        if (item.deliveryTypeProvided) {
          updateValues.deliveryType = item.deliveryType;
        }
        await tx
          .update(deliveriesTable)
          .set(updateValues)
          .where(
            and(
              eq(deliveriesTable.id, item.existingId),
              isNull(deliveriesTable.archivedAt),
            ),
          );
      }
      if (existingIds.length > 0) {
        await tx
          .update(deliveriesTable)
          .set({
            archivedAt: new Date(),
            archivedBy: req.appUser?.id ?? null,
            archivedByName:
              req.appUser?.name ?? req.appUser?.email ?? "неизвестно",
          })
          .where(
            and(
              inArray(deliveriesTable.id, existingIds),
              isNull(deliveriesTable.archivedAt),
            ),
          );
      }
      if (itemsToInsert.length === 0) {
        return { kind: "ok" as const, inserted: [] };
      }
      const inserted = await tx
        .insert(deliveriesTable)
        .values(
          itemsToInsert.map((item) => ({
            ...(() => {
              const existing = existingByKey.get(
                `${item.siteId}:${parsed.data.month}:${item.plannedDate ?? "undated"}`,
              );
              return {
                actualDate: item.actualDateProvided
                  ? item.actualDate
                  : (existing?.actualDate ?? null),
                correctedPlannedDate: item.correctedPlannedDateProvided
                  ? item.correctedPlannedDate
                  : (existing?.correctedPlannedDate ?? null),
                deliveryType: item.deliveryTypeProvided
                  ? item.deliveryType
                  : (existing?.deliveryType ?? null),
              };
            })(),
            siteId: item.siteId,
            driverUserId: item.driverUserId ?? null,
            plannedDate: item.plannedDate,
            scheduleMonth: parsed.data.month,
          })),
        )
        .returning();
      return { kind: "ok" as const, inserted };
      });
    } catch (error) {
      if (error instanceof BillingError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (isDeliveryDriverForeignKeyViolation(error)) {
        res.status(400).json({
          error: "Один или несколько пользователей не являются водителями",
        });
        return;
      }
      if (isDeliveryScheduleUniqueViolation(error)) {
        res.status(409).json({
          error: "Конфликт строк графика: слот уже занят другой доставкой",
        });
        return;
      }
      throw error;
    }

    if (replacement.kind === "actual") {
      res.status(409).json({
        error:
          "Полная замена запрещена: в выбранном месяце уже есть фактические даты",
      });
      return;
    }
    const inserted = replacement.inserted;

    const enrichment = await deliveryDtoEnrichmentMap(
      inserted.map((row) => row.id),
    );
    const dtos = await Promise.all(
      inserted.map(async (row) => {
        const site = siteMap.get(row.siteId)!;
        return toDeliveryDto(
          row,
          site.name,
          site.address,
          0,
          await getDriverName(row.driverUserId),
          null,
          {
            ...(enrichment.get(row.id) ?? {}),
            clientId: site.clientId,
            clientName: site.client,
          },
        );
      }),
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
    if (Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "Укажите данные доставки для изменения" });
      return;
    }
    if (
      req.body.correctedPlannedDate !== undefined &&
      req.body.correctedPlannedDate !== null &&
      (typeof req.body.correctedPlannedDate !== "string" ||
        !isRealIsoDate(req.body.correctedPlannedDate))
    ) {
      res.status(400).json({
        error:
          "Уточнённая плановая дата должна быть корректной датой в формате YYYY-MM-DD",
      });
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
    const [existing] = await db
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "Доставка не найдена" });
      return;
    }
    if (existing.archivedAt) {
      res.status(409).json({ error: "Архивная доставка недоступна для изменения" });
      return;
    }
    if (parsed.data.correctedPlannedDate !== undefined) {
      const correctedPlannedDate = parsed.data.correctedPlannedDate
        ? dateString(parsed.data.correctedPlannedDate)
        : null;
      const resultingPlannedDate =
        parsed.data.plannedDate !== undefined
          ? dateString(parsed.data.plannedDate)
          : existing!.plannedDate;
      if (correctedPlannedDate && !resultingPlannedDate) {
        res.status(409).json({
          error: "Сначала назначьте исходную плановую дату доставки",
        });
        return;
      }
      updateValues.correctedPlannedDate = correctedPlannedDate;
    } else if (
      parsed.data.plannedDate !== undefined &&
      parsed.data.plannedDate === null &&
      existing!.correctedPlannedDate
    ) {
      res.status(409).json({
        error: "Сначала очистите уточнённую плановую дату доставки",
      });
      return;
    }
    if (parsed.data.plannedDate !== undefined) {
      const plannedDate = dateString(parsed.data.plannedDate);
      if (!plannedDate && (existing!.actualDate || existing!.actApprovedAt)) {
        res.status(409).json({
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
    if (parsed.data.logisticianNote !== undefined) {
      if (!isLogisticianRole(req.appUser!.role)) {
        res.status(403).json({
          error: "Примечание к доставке может изменять только логист",
        });
        return;
      }
      updateValues.logisticianNote = parsed.data.logisticianNote;
    }
    if (parsed.data.driverUserId !== undefined)
      updateValues.driverUserId = parsed.data.driverUserId;

    const updateConditions = [
      eq(deliveriesTable.id, params.data.id),
      isNull(deliveriesTable.archivedAt),
    ];
    if (
      parsed.data.correctedPlannedDate instanceof Date &&
      !(parsed.data.plannedDate instanceof Date)
    ) {
      updateConditions.push(isNotNull(deliveriesTable.plannedDate));
    }
    if (
      parsed.data.plannedDate === null &&
      parsed.data.correctedPlannedDate === undefined
    ) {
      updateConditions.push(isNull(deliveriesTable.correctedPlannedDate));
    }

    let delivery: typeof deliveriesTable.$inferSelect | undefined;
    try {
      [delivery] = await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(deliveriesTable)
          .where(eq(deliveriesTable.id, params.data.id)).for("update");
        if (!locked) return [];
        if (parsed.data.plannedDate !== undefined &&
          await deliveryHasFrozenOrder(locked.id, tx)) throw new BillingError(409, BILLED_ORDER_ERROR);
        return tx.update(deliveriesTable).set(updateValues).where(and(...updateConditions)).returning();
      });
    } catch (error) {
      if (error instanceof BillingError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (isDeliveryDriverForeignKeyViolation(error)) {
        res
          .status(400)
          .json({ error: "Выбранный пользователь не является водителем" });
        return;
      }
      if (isDeliveryScheduleUniqueViolation(error)) {
        res.status(409).json({ error: "Такая строка графика уже существует" });
        return;
      }
      throw error;
    }

    if (!delivery) {
      const [stillExists] = await db
        .select({ id: deliveriesTable.id })
        .from(deliveriesTable)
        .where(
          and(
            eq(deliveriesTable.id, params.data.id),
            isNull(deliveriesTable.archivedAt),
          ),
        )
        .limit(1);
      if (stillExists) {
        res.status(409).json({
          error: "Состояние плановых дат изменилось. Повторите изменение",
        });
        return;
      }
      res.status(404).json({ error: "Delivery not found" });
      return;
    }

    const [site] = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.id, delivery.siteId));
    const counts = await photosCountMap([delivery.id]);
    const enrichment = await deliveryDtoEnrichmentMap([delivery.id]);

    res.json(
      UpdateDeliveryResponse.parse(
        toDeliveryDto(
          delivery,
          site?.name ?? "",
          site?.address ?? "",
          counts.get(delivery.id) ?? 0,
          await getDriverName(delivery.driverUserId),
          null,
          {
            ...(enrichment.get(delivery.id) ?? {}),
            clientId: site?.clientId ?? null,
            clientName: site?.client ?? null,
          },
        ),
      ),
    );
  },
);

router.post(
  "/deliveries/:id/restore",
  canEditDeliveries,
  async (req, res): Promise<void> => {
    const params = RestoreDeliveryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    let delivery: typeof deliveriesTable.$inferSelect | undefined;
    try {
      [delivery] = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(deliveriesTable)
          .where(eq(deliveriesTable.id, params.data.id))
          .for("update")
          .limit(1);
        if (!current) return [];
        if (!current.archivedAt) {
          const error = new Error("active delivery");
          (error as Error & { code?: string }).code = "ACTIVE_DELIVERY";
          throw error;
        }
        return tx
          .update(deliveriesTable)
          .set({
            archivedAt: null,
            archivedBy: null,
            archivedByName: null,
          })
          .where(
            and(
              eq(deliveriesTable.id, current.id),
              isNotNull(deliveriesTable.archivedAt),
            ),
          )
          .returning();
      });
    } catch (error) {
      if (
        (error as { code?: string }).code === "ACTIVE_DELIVERY" ||
        isDeliveryScheduleUniqueViolation(error)
      ) {
        res.status(409).json({
          error:
            "Невозможно восстановить доставку: строка графика уже существует",
        });
        return;
      }
      throw error;
    }

    if (!delivery) {
      const [current] = await db
        .select({ archivedAt: deliveriesTable.archivedAt })
        .from(deliveriesTable)
        .where(eq(deliveriesTable.id, params.data.id))
        .limit(1);
      res
        .status(current ? 409 : 404)
        .json({
          error: current
            ? "Доставка уже активна"
            : "Доставка не найдена",
        });
      return;
    }

    const [site] = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.id, delivery.siteId));
    const counts = await photosCountMap([delivery.id]);
    const enrichment = await deliveryDtoEnrichmentMap([delivery.id]);
    res.json(
      RestoreDeliveryResponse.parse(
        toDeliveryDto(
          delivery,
          site?.name ?? "",
          site?.address ?? "",
          counts.get(delivery.id) ?? 0,
          await getDriverName(delivery.driverUserId),
          null,
          {
            ...(enrichment.get(delivery.id) ?? {}),
            clientId: site?.clientId ?? null,
            clientName: site?.client ?? null,
          },
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
    if (existing.archivedAt) {
      res.status(409).json({ error: "Архивная доставка недоступна для изменения" });
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
      [delivery] = await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(deliveriesTable)
          .where(eq(deliveriesTable.id, params.data.id)).for("update");
        if (!locked || locked.archivedAt || locked.actualDate) {
          throw new BillingError(409, "Состояние доставки изменилось. Повторите изменение");
        }
        if (await deliveryHasFrozenOrder(locked.id, tx)) throw new BillingError(409, BILLED_ORDER_ERROR);
        return tx.update(deliveriesTable)
        .set({
          plannedDate: newDate,
          // Keep the very first planned date across repeated reschedules.
          rescheduledFromDate:
            existing.rescheduledFromDate ?? existing.plannedDate,
          rescheduledBy:
            req.appUser?.name ?? req.appUser?.email ?? "неизвестно",
          rescheduledAt: new Date(),
        })
        .where(
          and(
            eq(deliveriesTable.id, params.data.id),
            isNull(deliveriesTable.archivedAt),
          ),
        )
        .returning();
      });
    } catch (error) {
      if (error instanceof BillingError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (isDeliveryScheduleUniqueViolation(error)) {
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
    const enrichment = await deliveryDtoEnrichmentMap([delivery.id]);
    res.json(
      RescheduleDeliveryResponse.parse(
        toDeliveryDto(
          delivery,
          site?.name ?? "",
          site?.address ?? "",
          counts.get(delivery.id) ?? 0,
          await getDriverName(delivery.driverUserId),
          null,
          {
            ...(enrichment.get(delivery.id) ?? {}),
            clientId: site?.clientId ?? null,
            clientName: site?.client ?? null,
          },
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
      if (delivery.archivedAt)
        return { status: 409 as const, reason: "archived" as const };
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
          outcome.reason === "archived"
            ? "Архивная доставка недоступна для изменения"
            : outcome.reason === "done"
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
    const enrichment = await deliveryDtoEnrichmentMap([outcome.delivery.id]);
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
          null,
          {
            ...(enrichment.get(outcome.delivery.id) ?? {}),
            clientId: site?.clientId ?? null,
            clientName: site?.client ?? null,
          },
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
  if (
    delivery.archivedAt
      ? !canUserEditDeliveries(req.appUser)
      : !canAccessDeliveryActs(req.appUser, delivery.driverUserId)
  ) {
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
    .select({
      driverUserId: deliveriesTable.driverUserId,
      archivedAt: deliveriesTable.archivedAt,
    })
    .from(deliveriesTable)
    .where(eq(deliveriesTable.id, params.data.id))
    .limit(1);
  if (!authorizedDelivery) {
    res.status(404).json({ error: "Доставка не найдена" });
    return;
  }
  if (
    authorizedDelivery.archivedAt
      ? !canUserEditDeliveries(req.appUser)
      : !canUploadDeliveryActs(req.appUser, authorizedDelivery.driverUserId)
  ) {
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
      if (delivery.archivedAt) {
        return {
          status: 409 as const,
          error: "Архивная доставка недоступна для изменения",
          cleanup: true,
        };
      }
      const confirmedDate = parsed.data.confirmedActualDate;
      if (!delivery.actualDate && !confirmedDate) {
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

      if (confirmedDate) {
        const date = new Date(`${confirmedDate}T00:00:00Z`);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== confirmedDate || confirmedDate > todayLocalISO() ||
            !delivery.plannedDate ||
            !isDateInPlannedMonth(delivery.plannedDate, confirmedDate, delivery.scheduleMonth) ||
            (delivery.actualDate && delivery.actualDate !== confirmedDate)) {
          return { status: 400 as const, error: "Проверьте фактическую дату: она должна совпадать с месяцем плана и не менять уже подтверждённую дату", cleanup: true };
        }
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

      if (delivery.actApprovedAt || (!delivery.actualDate && confirmedDate)) {
        await tx
          .update(deliveriesTable)
          .set({
            ...(!delivery.actualDate && confirmedDate ? { actualDate: confirmedDate } : {}),
            actApprovedAt: null, actApprovedBy: null,
          })
          .where(eq(deliveriesTable.id, delivery.id));
      }

      return { status: 201 as const, photo, cleanup: false };
    });
  } catch (error) {
    req.log?.error(
      createStorageFailureLogFields({
        operation: "attach-delivery-act",
        error,
        objectPath: parsed.data.objectPath,
      }),
      "Failed to attach delivery act",
    );
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

router.patch("/delivery-photos/:id", async (req, res): Promise<void> => {
  const params = UpdateDeliveryPhotoCaptionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateDeliveryPhotoCaptionBody.safeParse(
    req.body && typeof req.body === "object" && typeof req.body.caption === "string"
      ? { ...req.body, caption: req.body.caption.trim() }
      : req.body,
  );
  if (!body.success) {
    res.status(400).json({ error: "Подпись должна содержать не более 200 символов" });
    return;
  }
  const caption = body.data.caption || null;

  try {
    const outcome = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ deliveryId: deliveryPhotosTable.deliveryId })
        .from(deliveryPhotosTable)
        .where(and(eq(deliveryPhotosTable.id, params.data.id), isNull(deliveryPhotosTable.deletionPendingAt)))
        .limit(1);
      if (!existing) return { status: 404 as const };

      // Lock the parent first, as upload/delete/approval do, then recheck the act.
      const [delivery] = await tx
        .select()
        .from(deliveriesTable)
        .where(eq(deliveriesTable.id, existing.deliveryId))
        .for("update")
        .limit(1);
      if (!delivery) return { status: 404 as const };
      if (delivery.archivedAt || delivery.deletionPendingAt || delivery.actApprovedAt) {
        return { status: 409 as const };
      }
      if (!canUploadDeliveryActs(req.appUser, delivery.driverUserId)) {
        return { status: 403 as const };
      }

      const [photo] = await tx
        .update(deliveryPhotosTable)
        .set({ caption })
        .where(and(
          eq(deliveryPhotosTable.id, params.data.id),
          eq(deliveryPhotosTable.deliveryId, delivery.id),
          isNull(deliveryPhotosTable.deletionPendingAt),
        ))
        .returning();
      if (!photo) return { status: 404 as const };
      return { status: 200 as const, photo };
    });
    if (outcome.status === 404) {
      res.status(404).json({ error: "Акт не найден" });
    } else if (outcome.status === 409) {
      res.status(409).json({ error: "Закрытая или архивная доставка недоступна для изменения" });
    } else if (outcome.status === 403) {
      res.status(403).json({ error: "Нет прав изменять акты этой доставки" });
    } else {
      res.json(UpdateDeliveryPhotoCaptionResponse.parse(outcome.photo));
    }
  } catch (error) {
    req.log?.error({ err: error }, "Failed to update delivery act caption");
    res.status(500).json({ error: "Не удалось сохранить подпись акта" });
  }
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
          .select({
            id: deliveriesTable.id,
            archivedAt: deliveriesTable.archivedAt,
          })
          .from(deliveriesTable)
          .where(eq(deliveriesTable.id, photo.deliveryId))
          .for("update")
          .limit(1);
        if (!delivery) {
          return { status: 404 as const };
        }
        if (await deliveryHasFrozenOrder(delivery.id, tx)) throw new BillingError(409, BILLED_ORDER_ERROR);
        if (delivery.archivedAt) {
          return { status: 409 as const };
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
        res.status(404).json({ error: "Акт не найден" });
        return;
      }
      if (prepared.status === 409) {
        res.status(409).json({ error: "Архивная доставка недоступна для изменения" });
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
      if (error instanceof BillingError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      req.log?.error({ err: error }, "Failed to delete delivery act");
      res.status(500).json({ error: "Не удалось удалить акт" });
      return;
    }

    res.sendStatus(204);
  },
);

router.delete(
  "/deliveries/:id",
  canEditDeliveries,
  async (req, res): Promise<void> => {
    const params = DeleteDeliveryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    try {
      const archived = await db.transaction(async (tx) => {
        const [delivery] = await tx
          .select({
            id: deliveriesTable.id,
            archivedAt: deliveriesTable.archivedAt,
            deletionPendingAt: deliveriesTable.deletionPendingAt,
          })
          .from(deliveriesTable)
          .where(eq(deliveriesTable.id, params.data.id))
          .for("update")
          .limit(1);
        if (!delivery) {
          return { status: 404 as const };
        }
        if (delivery.deletionPendingAt) {
          return { status: 409 as const, reason: "deleting" as const };
        }
        if (delivery.archivedAt) return { status: 204 as const };
        if (await deliveryHasFrozenOrder(delivery.id, tx)) throw new BillingError(409, BILLED_ORDER_ERROR);
        await tx
          .update(deliveriesTable)
          .set({
            archivedAt: new Date(),
            archivedBy: req.appUser?.id ?? null,
            archivedByName:
              req.appUser?.name ?? req.appUser?.email ?? "неизвестно",
          })
          .where(
            and(
              eq(deliveriesTable.id, delivery.id),
              isNull(deliveriesTable.archivedAt),
            ),
          );
        return { status: 204 as const };
      });

      if (archived.status === 404) {
        res.status(404).json({ error: "Доставка не найдена" });
        return;
      }
      if (archived.status === 409) {
        res.status(409).json({
          error: "Доставка уже подготовлена к физическому удалению",
        });
        return;
      }
    } catch (error) {
      if (error instanceof BillingError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      req.log?.error({ err: error }, "Failed to archive delivery");
      res.status(500).json({ error: "Не удалось архивировать доставку" });
      return;
    }

    res.sendStatus(204);
  },
);

export default router;
