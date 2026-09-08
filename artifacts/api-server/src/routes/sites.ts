import { Router, type IRouter } from "express";
import { eq, ilike, or } from "drizzle-orm";
import { db, sitesTable, tradeNamesTable, deliveryTypesTable, appUsersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import {
  ListSitesQueryParams,
  CreateSiteBody,
  GetSiteParams,
  UpdateSiteParams,
  UpdateSiteBody,
  DeleteSiteParams,
  ListSitesResponse,
  CreateSiteResponse,
  GetSiteResponse,
  UpdateSiteResponse,
  CreateSitesBulkBody,
  CreateSitesBulkResponse,
  CloseSiteParams,
  CloseSiteBody,
  CloseSiteResponse,
  ReopenSiteParams,
  ReopenSiteResponse,
} from "@workspace/api-zod";
import { requirePermission, requireSectionAccess } from "../middlewares/requirePermission";
import { todayLocalISO } from "../lib/deliveries";
import { findInvalidDriverUserIds } from "../lib/drivers";

const router: IRouter = Router();
router.use("/sites", requireSectionAccess("sites"));
const canEditSites = requirePermission("sites");

// Непустое «Торговое название объекта» принимается строго из справочника
// trade_names. Пустое значение допустимо.
async function findUnknownTradeNames(values: string[]): Promise<string[]> {
  const unique = Array.from(
    new Set(values.map((v) => v.trim()).filter((v) => v.length > 0)),
  );
  const known = unique.length
    ? await db
        .select({ name: tradeNamesTable.name })
        .from(tradeNamesTable)
        .where(inArray(tradeNamesTable.name, unique))
    : [];
  const knownSet = new Set(known.map((r) => r.name));
  return unique.filter((v) => !knownSet.has(v));
}

// «Тип поставки» — из справочника delivery_types; пустое значение допустимо.
async function findUnknownDeliveryTypes(values: string[]): Promise<string[]> {
  const unique = Array.from(
    new Set(values.map((v) => v.trim()).filter((v) => v.length > 0)),
  );
  if (unique.length === 0) return [];
  const known = await db
    .select({ name: deliveryTypesTable.name })
    .from(deliveryTypesTable)
    .where(inArray(deliveryTypesTable.name, unique));
  const knownSet = new Set(known.map((r) => r.name));
  return unique.filter((v) => !knownSet.has(v));
}

function deliveryTypeError(unknown: string[]): string {
  const shown = unknown.map((v) => `«${v}»`).slice(0, 10).join(", ");
  return `Тип поставки должен быть из справочника. Не найдено: ${shown}${unknown.length > 10 ? " и др." : ""}. Добавьте тип в справочник «Типы поставки» или исправьте значение.`;
}

function tradeNameError(unknown: string[]): string {
  const shown = unknown
    .map((v) => (v.length === 0 ? "(пусто)" : `«${v}»`))
    .slice(0, 10)
    .join(", ");
  return `Торговое название объекта должно быть из справочника. Не найдено: ${shown}${unknown.length > 10 ? " и др." : ""}. Добавьте название в справочник или исправьте значение.`;
}

function isClosedToday(row: typeof sitesTable.$inferSelect): boolean {
  if (!row.closedFrom) return false;
  const today = todayLocalISO();
  if (row.closedFrom > today) return false;
  if (row.reopenDate && row.reopenDate <= today) return false;
  return true;
}

function toSiteDto(
  row: typeof sitesTable.$inferSelect,
  driver = "Не назначен",
) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    branch: row.branch,
    customer: row.customer,
    client: row.client,
    manager: row.manager,
    managerContact: row.managerContact,
    director: row.director,
    project: row.project,
    driverUserId: row.driverUserId,
    driver,
    deliveryType: row.deliveryType,
    closedFrom: row.closedFrom,
    reopenDate: row.reopenDate,
    closureReason: row.closureReason,
    closedBy: row.closedBy,
    isClosed: isClosedToday(row),
    createdAt: row.createdAt,
  };
}

async function getDriverName(driverUserId: string | null): Promise<string> {
  if (!driverUserId) return "Не назначен";
  const [user] = await db
    .select({ name: appUsersTable.name, email: appUsersTable.email })
    .from(appUsersTable)
    .where(eq(appUsersTable.id, driverUserId));
  return user?.name || user?.email || "Не назначен";
}

router.get("/sites", async (req, res): Promise<void> => {
  const query = ListSitesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const rows = await db
    .select({
      site: sitesTable,
      driverName: appUsersTable.name,
      driverEmail: appUsersTable.email,
    })
    .from(sitesTable)
    .leftJoin(appUsersTable, eq(sitesTable.driverUserId, appUsersTable.id))
    .where(
      query.data.search
        ? or(
            ilike(sitesTable.name, `%${query.data.search}%`),
            ilike(sitesTable.address, `%${query.data.search}%`),
            ilike(sitesTable.branch, `%${query.data.search}%`),
            ilike(sitesTable.customer, `%${query.data.search}%`),
            ilike(sitesTable.client, `%${query.data.search}%`),
            ilike(sitesTable.manager, `%${query.data.search}%`),
            ilike(sitesTable.director, `%${query.data.search}%`),
            ilike(sitesTable.project, `%${query.data.search}%`),
            ilike(appUsersTable.name, `%${query.data.search}%`),
            ilike(appUsersTable.email, `%${query.data.search}%`),
            ilike(sitesTable.deliveryType, `%${query.data.search}%`),
          )
        : undefined,
    )
    .orderBy(sitesTable.name);

  res.json(ListSitesResponse.parse(rows.map((row) =>
    toSiteDto(row.site, row.driverName || row.driverEmail || "Не назначен"))));
});

router.post("/sites", canEditSites, async (req, res): Promise<void> => {
  const parsed = CreateSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.name, parsed.data.name));

  if (existing) {
    res.status(409).json({ error: "Объект с таким названием уже существует" });
    return;
  }

  const unknown = await findUnknownTradeNames([parsed.data.customer ?? ""]);
  if (unknown.length > 0) {
    res.status(400).json({ error: tradeNameError(unknown) });
    return;
  }

  const unknownTypes = await findUnknownDeliveryTypes([
    parsed.data.deliveryType ?? "",
  ]);
  if (unknownTypes.length > 0) {
    res.status(400).json({ error: deliveryTypeError(unknownTypes) });
    return;
  }
  if ((await findInvalidDriverUserIds([parsed.data.driverUserId])).length > 0) {
    res.status(400).json({ error: "Выбранный пользователь не является водителем" });
    return;
  }

  const [site] = await db
    .insert(sitesTable)
    .values({
      name: parsed.data.name,
      address: parsed.data.address,
      branch: parsed.data.branch,
      customer: (parsed.data.customer ?? "").trim(),
      client: parsed.data.client,
      manager: parsed.data.manager,
      managerContact: parsed.data.managerContact ?? "",
      director: parsed.data.director,
      project: parsed.data.project,
      driverUserId: parsed.data.driverUserId ?? null,
      deliveryType: (parsed.data.deliveryType ?? "").trim(),
    })
    .returning();

  res.status(201).json(CreateSiteResponse.parse(
    toSiteDto(site, await getDriverName(site.driverUserId)),
  ));
});

router.post("/sites/bulk", canEditSites, async (req, res): Promise<void> => {
  const parsed = CreateSitesBulkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const unknown = await findUnknownTradeNames(
    parsed.data.items.map((i) => i.customer ?? ""),
  );
  if (unknown.length > 0) {
    res.status(400).json({ error: tradeNameError(unknown) });
    return;
  }

  const unknownTypes = await findUnknownDeliveryTypes(
    parsed.data.items.map((i) => i.deliveryType ?? ""),
  );
  if (unknownTypes.length > 0) {
    res.status(400).json({ error: deliveryTypeError(unknownTypes) });
    return;
  }
  if ((await findInvalidDriverUserIds(parsed.data.items.map((item) => item.driverUserId))).length > 0) {
    res.status(400).json({ error: "Один или несколько пользователей не являются водителями" });
    return;
  }

  const results: ReturnType<typeof toSiteDto>[] = [];

  for (const item of parsed.data.items) {
    const [existing] = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.name, item.name));

    const values = {
      name: item.name,
      address: item.address,
      branch: item.branch,
      customer: (item.customer ?? "").trim(),
      client: item.client,
      manager: item.manager,
      managerContact: item.managerContact ?? "",
      director: item.director,
      project: item.project,
      driverUserId: item.driverUserId ?? null,
      deliveryType: (item.deliveryType ?? "").trim(),
    };

    let site;
    if (existing) {
      [site] = await db
        .update(sitesTable)
        .set(values)
        .where(eq(sitesTable.id, existing.id))
        .returning();
    } else {
      [site] = await db.insert(sitesTable).values(values).returning();
    }

    results.push(toSiteDto(site, await getDriverName(site.driverUserId)));
  }

  res.status(201).json(CreateSitesBulkResponse.parse(results));
});

router.get("/sites/:id", async (req, res): Promise<void> => {
  const params = GetSiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, params.data.id));

  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  res.json(GetSiteResponse.parse(toSiteDto(site, await getDriverName(site.driverUserId))));
});

router.patch("/sites/:id", canEditSites, async (req, res): Promise<void> => {
  const params = UpdateSiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (parsed.data.name) {
    const [existing] = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.name, parsed.data.name));
    if (existing && existing.id !== params.data.id) {
      res.status(409).json({ error: "Объект с таким названием уже существует" });
      return;
    }
  }

  if (parsed.data.customer !== undefined) {
    const unknown = await findUnknownTradeNames([parsed.data.customer]);
    if (unknown.length > 0) {
      res.status(400).json({ error: tradeNameError(unknown) });
      return;
    }
  }

  if (parsed.data.deliveryType !== undefined) {
    const unknownTypes = await findUnknownDeliveryTypes([parsed.data.deliveryType]);
    if (unknownTypes.length > 0) {
      res.status(400).json({ error: deliveryTypeError(unknownTypes) });
      return;
    }
  }
  if (
    parsed.data.driverUserId !== undefined &&
    (await findInvalidDriverUserIds([parsed.data.driverUserId])).length > 0
  ) {
    res.status(400).json({ error: "Выбранный пользователь не является водителем" });
    return;
  }

  const updateValues: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateValues.name = parsed.data.name;
  if (parsed.data.address !== undefined) updateValues.address = parsed.data.address;
  if (parsed.data.branch !== undefined) updateValues.branch = parsed.data.branch;
  if (parsed.data.customer !== undefined) updateValues.customer = parsed.data.customer.trim();
  if (parsed.data.client !== undefined) updateValues.client = parsed.data.client;
  if (parsed.data.manager !== undefined) updateValues.manager = parsed.data.manager;
  if (parsed.data.managerContact !== undefined) updateValues.managerContact = parsed.data.managerContact;
  if (parsed.data.director !== undefined) updateValues.director = parsed.data.director;
  if (parsed.data.project !== undefined) updateValues.project = parsed.data.project;
  if (parsed.data.driverUserId !== undefined) updateValues.driverUserId = parsed.data.driverUserId;
  if (parsed.data.deliveryType !== undefined) updateValues.deliveryType = parsed.data.deliveryType.trim();

  const [site] = await db
    .update(sitesTable)
    .set(updateValues)
    .where(eq(sitesTable.id, params.data.id))
    .returning();

  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  res.json(UpdateSiteResponse.parse(toSiteDto(site, await getDriverName(site.driverUserId))));
});

router.post("/sites/:id/close", canEditSites, async (req, res): Promise<void> => {
  const params = CloseSiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CloseSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const closedFrom = parsed.data.closedFrom.toISOString().slice(0, 10);
  const reopenDate = parsed.data.reopenDate
    ? parsed.data.reopenDate.toISOString().slice(0, 10)
    : null;
  if (reopenDate && reopenDate <= closedFrom) {
    res.status(400).json({ error: "Дата открытия должна быть позже даты закрытия" });
    return;
  }

  const [site] = await db
    .update(sitesTable)
    .set({
      closedFrom,
      reopenDate,
      closureReason: parsed.data.reason ?? null,
      closedBy: req.appUser?.name ?? req.appUser?.email ?? "неизвестно",
    })
    .where(eq(sitesTable.id, params.data.id))
    .returning();

  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  res.json(CloseSiteResponse.parse(toSiteDto(site, await getDriverName(site.driverUserId))));
});

router.post("/sites/:id/reopen", canEditSites, async (req, res): Promise<void> => {
  const params = ReopenSiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [site] = await db
    .update(sitesTable)
    .set({ closedFrom: null, reopenDate: null, closureReason: null, closedBy: null })
    .where(eq(sitesTable.id, params.data.id))
    .returning();

  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  res.json(ReopenSiteResponse.parse(toSiteDto(site, await getDriverName(site.driverUserId))));
});

router.delete("/sites/:id", canEditSites, async (req, res): Promise<void> => {
  const params = DeleteSiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [site] = await db
    .delete(sitesTable)
    .where(eq(sitesTable.id, params.data.id))
    .returning();

  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
