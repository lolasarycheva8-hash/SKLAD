import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import {
  appUsersTable,
  canonicalClientNameSql,
  clientsTable,
  db,
  deliveryTypesTable,
  normalizeClientNameWhitespace,
  sitesTable,
  siteChangeRequestsTable,
  type SiteChangeRequestPayload,
  tradeNamesTable,
} from "@workspace/db";
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
  UpdateSiteFeaturesParams,
  UpdateSiteFeaturesBody,
  UpdateSiteFeaturesResponse,
  CreateSitesBulkBody,
  CreateSitesBulkResponse,
  CloseSiteParams,
  CloseSiteBody,
  CloseSiteResponse,
  ReopenSiteParams,
  ReopenSiteResponse,
  ListSiteChangeRequestsQueryParams,
  ListSiteChangeRequestsResponse,
  CreateSiteChangeRequestParams,
  CreateSiteChangeRequestBody,
  CreateSiteChangeRequestResponse,
  ApproveSiteChangeRequestParams,
  ApproveSiteChangeRequestResponse,
  RejectSiteChangeRequestParams,
  RejectSiteChangeRequestResponse,
} from "@workspace/api-zod";
import {
  requireAdmin,
  requirePermission,
  requireSectionAccess,
} from "../middlewares/requirePermission";
import { todayLocalISO } from "../lib/deliveries";
import { findInvalidDriverUserIds, loadDriverUsers } from "../lib/drivers";
import {
  createBulkSiteImportSlowWarning,
  type BulkSiteImportLogFields,
} from "../lib/bulk-site-import-log";
import { recordBulkSiteImportSlowWarning } from "../lib/bulk-site-import-slow-store";

const router: IRouter = Router();
router.use("/sites", requireSectionAccess("sites"));
type DbOrTx = typeof db | PgTransaction<any, any, any>;
const BULK_SITE_WRITE_BATCH_SIZE = 100;
const BULK_SITE_LOOKUP_BATCH_SIZE = 100;

function elapsedMilliseconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function splitLookupBatches<T>(items: T[]): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += BULK_SITE_LOOKUP_BATCH_SIZE) {
    batches.push(items.slice(index, index + BULK_SITE_LOOKUP_BATCH_SIZE));
  }
  return batches;
}

function splitBulkSiteWriteBatches<T extends { item: { name: string } }>(
  items: T[],
): T[][] {
  const batches: T[][] = [];
  let batch: T[] = [];
  let names = new Set<string>();

  for (const item of items) {
    if (
      batch.length >= BULK_SITE_WRITE_BATCH_SIZE ||
      names.has(item.item.name)
    ) {
      batches.push(batch);
      batch = [];
      names = new Set();
    }
    batch.push(item);
    names.add(item.item.name);
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

// Непустое «Торговое название объекта» принимается строго из справочника
// trade_names. Пустое значение допустимо только для bulk-импорта и истории.
async function findUnknownTradeNames(
  values: string[],
  database: DbOrTx = db,
): Promise<string[]> {
  const unique = Array.from(
    new Set(values.map((v) => v.trim()).filter((v) => v.length > 0)),
  );
  const known: Array<{ name: string }> = [];
  for (const batch of splitLookupBatches(unique)) {
    known.push(
      ...(await database
        .select({ name: tradeNamesTable.name })
        .from(tradeNamesTable)
        .where(inArray(tradeNamesTable.name, batch))),
    );
  }
  const knownSet = new Set(known.map((r) => r.name));
  return unique.filter((v) => !knownSet.has(v));
}

// «Тип поставки» — из справочника delivery_types; пустое значение допустимо.
async function findUnknownDeliveryTypes(
  values: string[],
  database: DbOrTx = db,
): Promise<string[]> {
  const unique = Array.from(
    new Set(values.map((v) => v.trim()).filter((v) => v.length > 0)),
  );
  if (unique.length === 0) return [];
  const known: Array<{ name: string }> = [];
  for (const batch of splitLookupBatches(unique)) {
    known.push(
      ...(await database
        .select({ name: deliveryTypesTable.name })
        .from(deliveryTypesTable)
        .where(inArray(deliveryTypesTable.name, batch))),
    );
  }
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
    client: normalizeClientNameWhitespace(row.client),
    clientId: row.clientId,
    manager: row.manager,
    managerContact: row.managerContact,
    director: row.director,
    project: row.project,
    driverUserId: row.driverUserId,
    driver,
    deliveryType: row.deliveryType,
    features: row.features,
    closedFrom: row.closedFrom,
    reopenDate: row.reopenDate,
    closureReason: row.closureReason,
    closedBy: row.closedBy,
    isClosed: isClosedToday(row),
    createdAt: row.createdAt,
  };
}

function toChangeRequestDto(
  row: typeof siteChangeRequestsTable.$inferSelect,
) {
  return row;
}

const CHANGEABLE_SITE_KEYS = [
  "name",
  "address",
  "branch",
  "customer",
  "clientId",
  "manager",
  "managerContact",
  "director",
  "project",
  "driverUserId",
  "deliveryType",
] as const;

function siteChangedSinceProposal(
  site: typeof sitesTable.$inferSelect,
  originalPayload: SiteChangeRequestPayload,
): boolean {
  return Object.entries(originalPayload).some(
    ([key, value]) => site[key as keyof typeof site] !== value,
  );
}

function originalPayloadFor(
  site: typeof sitesTable.$inferSelect,
  payload: SiteChangeRequestPayload,
): SiteChangeRequestPayload {
  return Object.fromEntries(
    CHANGEABLE_SITE_KEYS.filter((key) => key in payload).map((key) => [
      key,
      site[key],
    ]),
  );
}

async function resolveClient(
  database: DbOrTx,
  clientId: string,
) {
  const [client] = await database
    .select({ id: clientsTable.id, name: clientsTable.name })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  if (!client) return { error: "Выбранный клиент не найден" } as const;
  return { client } as const;
}

async function lockSiteClientWrites(
  transaction: PgTransaction<any, any, any>,
) {
  await transaction.execute(
    sql`LOCK TABLE clients IN SHARE ROW EXCLUSIVE MODE`,
  );
  await transaction.execute(
    sql`LOCK TABLE sites IN SHARE ROW EXCLUSIVE MODE`,
  );
}

async function getDriverName(
  driverUserId: string | null,
  database: DbOrTx = db,
): Promise<string> {
  if (!driverUserId) return "Не назначен";
  const [user] = await database
    .select({ name: appUsersTable.name, email: appUsersTable.email })
    .from(appUsersTable)
    .where(eq(appUsersTable.id, driverUserId));
  return user?.name || user?.email || "Не назначен";
}

class InvalidBulkDriverError extends Error {}

function hasPostgresConstraint(
  error: unknown,
  constraint: string,
): boolean {
  let current = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    if (
      "code" in current &&
      current.code === "23503" &&
      "constraint" in current &&
      current.constraint === constraint
    ) {
      return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

function hasPostgresCode(error: unknown, code: string): boolean {
  let current = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    if ("code" in current && current.code === code) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
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
            ilike(sitesTable.features, `%${query.data.search}%`),
          )
        : undefined,
    )
    .orderBy(sitesTable.name);

  res.json(ListSitesResponse.parse(rows.map((row) =>
    toSiteDto(row.site, row.driverName || row.driverEmail || "Не назначен"))));
});

router.post("/sites", requirePermission("sites"), async (req, res): Promise<void> => {
  const parsed = CreateSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const customer = parsed.data.customer.trim();
  if (customer.length === 0) {
    res.status(400).json({ error: "Торговое название объекта обязательно" });
    return;
  }

  const unknown = await findUnknownTradeNames([customer]);
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
  let outcome;
  try {
    outcome = await db.transaction(async (tx) => {
      await lockSiteClientWrites(tx);
      const [existing] = await tx
        .select({ id: sitesTable.id })
        .from(sitesTable)
        .where(eq(sitesTable.name, parsed.data.name));
      if (existing) {
        return {
          error: "Объект с таким названием уже существует",
          status: 409 as const,
        };
      }
      const resolvedClient = await resolveClient(
        tx,
        parsed.data.clientId,
      );
      if ("error" in resolvedClient) {
        return { error: resolvedClient.error, status: 400 as const };
      }
      const [site] = await tx
        .insert(sitesTable)
        .values({
          name: parsed.data.name,
          address: parsed.data.address,
          branch: parsed.data.branch,
          customer,
          client: resolvedClient.client.name,
          clientId: resolvedClient.client.id,
          manager: parsed.data.manager,
          managerContact: parsed.data.managerContact ?? "",
          director: parsed.data.director,
          project: parsed.data.project,
          driverUserId: parsed.data.driverUserId ?? null,
          deliveryType: (parsed.data.deliveryType ?? "").trim(),
          features: (parsed.data.features ?? "").trim(),
        })
        .returning();
      return { site };
    });
  } catch (error) {
    if (
      hasPostgresConstraint(
        error,
        "sites_driver_user_id_app_users_id_fk",
      )
    ) {
      res.status(400).json({ error: "Выбранный пользователь не является водителем" });
      return;
    }
    throw error;
  }
  if ("error" in outcome) {
    res.status(outcome.status ?? 400).json({ error: outcome.error });
    return;
  }

  res.status(201).json(CreateSiteResponse.parse(
    toSiteDto(outcome.site, await getDriverName(outcome.site.driverUserId)),
  ));
});

router.post("/sites/bulk", requireAdmin, async (req, res): Promise<void> => {
  const startedAt = process.hrtime.bigint();
  let validationDurationMs = 0;
  let writeDurationMs = 0;
  let rowCount = 0;
  let writeBatchCount = 0;
  let succeeded = 0;

  try {
    const validationStartedAt = process.hrtime.bigint();
    const parsed = CreateSitesBulkBody.safeParse(req.body);
    if (!parsed.success) {
      validationDurationMs = elapsedMilliseconds(validationStartedAt);
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    rowCount = parsed.data.items.length;
    const explicitIds = parsed.data.items
      .map((item) => item.id?.toLowerCase())
      .filter((id): id is string => id !== undefined);
    if (new Set(explicitIds).size !== explicitIds.length) {
      validationDurationMs = elapsedMilliseconds(validationStartedAt);
      res.status(400).json({ error: "ID объекта повторяется в файле" });
      return;
    }

    const unknown = await findUnknownTradeNames(
      parsed.data.items.map((i) => i.customer ?? ""),
    );
    if (unknown.length > 0) {
      validationDurationMs = elapsedMilliseconds(validationStartedAt);
      res.status(400).json({ error: tradeNameError(unknown) });
      return;
    }

    const unknownTypes = await findUnknownDeliveryTypes(
      parsed.data.items.map((i) => i.deliveryType ?? ""),
    );
    if (unknownTypes.length > 0) {
      validationDurationMs = elapsedMilliseconds(validationStartedAt);
      res.status(400).json({ error: deliveryTypeError(unknownTypes) });
      return;
    }
    validationDurationMs = elapsedMilliseconds(validationStartedAt);

    const writeStartedAt = process.hrtime.bigint();
    try {
      const outcome = await db.transaction(async (tx) => {
        await lockSiteClientWrites(tx);
        const clientIds = Array.from(
          new Set(parsed.data.items.map((item) => item.clientId.toLowerCase())),
        );
        const clients: Array<{ id: string; name: string }> = [];
        for (const batch of splitLookupBatches(clientIds)) {
          clients.push(
            ...(await tx
              .select({ id: clientsTable.id, name: clientsTable.name })
              .from(clientsTable)
              .where(inArray(clientsTable.id, batch))),
          );
        }
        const clientsById = new Map(clients.map((client) => [client.id, client]));

        const resolvedItems: Array<{
          index: number;
          item: (typeof parsed.data.items)[number];
          client: { id: string; name: string };
        }> = [];
        for (const [index, item] of parsed.data.items.entries()) {
          const client = clientsById.get(item.clientId.toLowerCase());
          if (!client) {
            return {
              error: `Объект «${item.name}»: Выбранный клиент не найден`,
              status: 400 as const,
            };
          }
          resolvedItems.push({ index, item, client });
        }

        const existingSitesById = new Map<
          string,
          typeof sitesTable.$inferSelect
        >();
        for (const batch of splitLookupBatches(explicitIds)) {
          const existingSites = await tx
            .select()
            .from(sitesTable)
            .where(inArray(sitesTable.id, batch));
          for (const site of existingSites) {
            existingSitesById.set(site.id, site);
          }
        }
        for (const id of explicitIds) {
          if (!existingSitesById.has(id)) {
            return {
              error: `Объект с ID «${id}» не найден`,
              status: 400 as const,
            };
          }
        }

        const explicitlyNamedIds = new Map<string, string>();
        for (const { item } of resolvedItems) {
          if (!item.id) continue;
          const existingId = explicitlyNamedIds.get(item.name);
          if (existingId && existingId !== item.id.toLowerCase()) {
            return {
              error: "Объект с таким названием уже существует",
              status: 409 as const,
            };
          }
          explicitlyNamedIds.set(item.name, item.id.toLowerCase());
        }
        const ambiguousNames = new Set(
          resolvedItems
            .filter(({ item }) => !item.id && explicitlyNamedIds.has(item.name))
            .map(({ item }) => item.name),
        );
        if (ambiguousNames.size > 0) {
          const name = ambiguousNames.values().next().value as string;
          return {
            error: `Неоднозначный импорт: объект «${name}» указан одновременно с ID и без ID`,
            status: 409 as const,
          };
        }
        const existingSitesByName = new Map<
          string,
          typeof sitesTable.$inferSelect
        >();
        const noIdNames = Array.from(
          new Set(
            resolvedItems
              .filter(({ item }) => !item.id)
              .map(({ item }) => item.name),
          ),
        );
        for (const batch of splitLookupBatches(
          Array.from(
            new Set([
              ...explicitlyNamedIds.keys(),
              ...(explicitIds.length > 0 ? noIdNames : []),
            ]),
          ),
        )) {
          const existingSites = await tx
            .select()
            .from(sitesTable)
            .where(inArray(sitesTable.name, batch));
          for (const site of existingSites) {
            existingSitesByName.set(site.name, site);
          }
        }
        const explicitIdSet = new Set(explicitIds);
        for (const name of noIdNames) {
          const snapshotSite = existingSitesByName.get(name);
          if (snapshotSite && explicitIdSet.has(snapshotSite.id)) {
            return {
              error: `Неоднозначный импорт: объект «${name}» одновременно переименовывается по ID и обновляется без ID`,
              status: 409 as const,
            };
          }
        }
        for (const [name, id] of explicitlyNamedIds) {
          const siteWithName = existingSitesByName.get(name);
          if (siteWithName && siteWithName.id !== id) {
            return {
              error: "Объект с таким названием уже существует",
              status: 409 as const,
            };
          }
        }

        const sitesByInputIndex: Array<
          typeof sitesTable.$inferSelect | undefined
        > = new Array(resolvedItems.length);
        const valuesFor = (
          item: (typeof parsed.data.items)[number],
          client: { id: string; name: string },
        ) => ({
          name: item.name,
          address: item.address,
          branch: item.branch,
          customer: (item.customer ?? "").trim(),
          client: client.name,
          clientId: client.id,
          manager: item.manager,
          managerContact: item.managerContact ?? "",
          director: item.director,
          project: item.project,
          driverUserId: item.driverUserId ?? null,
          deliveryType: (item.deliveryType ?? "").trim(),
          features: (item.features ?? "").trim(),
        });

        for (const { index, item, client } of resolvedItems) {
          if (!item.id) continue;
          writeBatchCount += 1;
          const [site] = await tx
            .update(sitesTable)
            .set(valuesFor(item, client))
            .where(eq(sitesTable.id, item.id))
            .returning();
          if (!site) {
            throw new Error(`Bulk site update did not return «${item.id}»`);
          }
          sitesByInputIndex[index] = site;
        }

        const nameUpserts = resolvedItems.filter(({ item }) => !item.id);
        for (const batch of splitBulkSiteWriteBatches(nameUpserts)) {
          writeBatchCount += 1;
          const values = batch.map(({ item, client }) =>
            valuesFor(item, client),
          );
          const writtenSites = await tx
            .insert(sitesTable)
            .values(values)
            .onConflictDoUpdate({
              target: sitesTable.name,
              set: {
                address: sql`excluded.address`,
                branch: sql`excluded.branch`,
                customer: sql`excluded.customer`,
                client: sql`excluded.client`,
                clientId: sql`excluded.client_id`,
                manager: sql`excluded.manager`,
                managerContact: sql`excluded.manager_contact`,
                director: sql`excluded.director`,
                project: sql`excluded.project`,
                driverUserId: sql`excluded.driver_user_id`,
                deliveryType: sql`excluded.delivery_type`,
                features: sql`excluded.features`,
              },
            })
            .returning();
          const writtenSitesByName = new Map(
            writtenSites.map((site) => [site.name, site]),
          );
          for (const { index, item } of batch) {
            const site = writtenSitesByName.get(item.name);
            if (!site) {
              throw new Error(`Bulk site write did not return «${item.name}»`);
            }
            sitesByInputIndex[index] = site;
          }
        }
        const sites = sitesByInputIndex.map((site, index) => {
          if (!site) {
            throw new Error(`Bulk site write did not return row ${index + 1}`);
          }
          return site;
        });
        const driverUsers = await loadDriverUsers(
          sites.map((site) => site.driverUserId),
          tx,
        );
        if (driverUsers.invalidIds.length > 0) {
          throw new InvalidBulkDriverError();
        }
        const results = sites.map((site) =>
          toSiteDto(
            site,
            site.driverUserId
              ? driverUsers.namesById.get(site.driverUserId) ?? "Не назначен"
              : "Не назначен",
          ),
        );
        return { results: CreateSitesBulkResponse.parse(results) };
      });
      if ("error" in outcome) {
        res.status(outcome.status ?? 400).json({ error: outcome.error });
        return;
      }

      succeeded = 1;
      res.status(201).json(outcome.results);
    } catch (error) {
      if (
        error instanceof InvalidBulkDriverError ||
        hasPostgresConstraint(
          error,
          "sites_driver_user_id_app_users_id_fk",
        )
      ) {
        res.status(400).json({
          error: "Один или несколько пользователей не являются водителями",
        });
        return;
      }
      if (hasPostgresCode(error, "23505")) {
        res.status(409).json({
          error: "Объект с таким названием уже существует",
        });
        return;
      }
      throw error;
    } finally {
      writeDurationMs = elapsedMilliseconds(writeStartedAt);
    }
  } finally {
    for (const warning of [
      createBulkSiteImportSlowWarning(
        "validation",
        rowCount,
        validationDurationMs,
      ),
      createBulkSiteImportSlowWarning("write", rowCount, writeDurationMs),
    ]) {
      if (warning) {
        req.log.warn(warning, "Bulk site import phase exceeded slow threshold");
        try {
          const signal = await recordBulkSiteImportSlowWarning(warning);
          if (signal) {
            req.log.error(
              signal,
              "Bulk site import phase repeatedly exceeded slow threshold",
            );
          }
        } catch {
          // Diagnostic persistence must not replace an import's result/error.
          // Do not log SQL errors: their bindings may contain sensitive values.
          req.log.error(
            { phase: warning.phase },
            "Failed to persist bulk site import slow warning",
          );
        }
      }
    }
    const fields: BulkSiteImportLogFields = {
      rowCount,
      writeBatchCount,
      validationDurationMs,
      writeDurationMs,
      totalDurationMs: elapsedMilliseconds(startedAt),
      succeeded,
    };
    req.log.info(fields, "Bulk site import completed");
  }
});

router.get(
  "/site-change-requests",
  requireAdmin,
  async (req, res): Promise<void> => {
    const query = ListSiteChangeRequestsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }
    const rows = await db
      .select()
      .from(siteChangeRequestsTable)
      .where(
        query.data.status
          ? eq(siteChangeRequestsTable.status, query.data.status)
          : undefined,
      )
      .orderBy(sql`${siteChangeRequestsTable.createdAt} desc`);
    res.json(
      ListSiteChangeRequestsResponse.parse(
        rows.map((row) => toChangeRequestDto(row)),
      ),
    );
  },
);

router.post(
  "/sites/:id/change-requests",
  async (req, res): Promise<void> => {
    const user = req.appUser;
    if (
      user?.role !== "logistician" ||
      !user.editableSections.includes("sites")
    ) {
      res.status(403).json({ error: "Создавать предложения может только логист" });
      return;
    }
    const params = CreateSiteChangeRequestParams.safeParse(req.params);
    const parsed = CreateSiteChangeRequestBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const outcome = await db.transaction(async (tx) => {
        await lockSiteClientWrites(tx);
        const [site] = await tx
          .select()
          .from(sitesTable)
          .where(eq(sitesTable.id, params.data.id));
        if (!site) return { status: 404 as const };

        const payload = parsed.data as SiteChangeRequestPayload;
        const changedPayload = Object.fromEntries(
          Object.entries(payload).filter(
            ([key, value]) =>
              value !== site[key as keyof typeof site],
          ),
        ) as SiteChangeRequestPayload;
        if (Object.keys(changedPayload).length === 0) {
          return {
            status: 400 as const,
            error: "Предложение не содержит изменений",
          };
        }
        const [request] = await tx
          .insert(siteChangeRequestsTable)
          .values({
            siteId: site.id,
            siteName: site.name,
            authorUserId: user.id,
            authorName: user.name || user.email,
            authorEmail: user.email,
            payload: changedPayload,
            originalPayload: originalPayloadFor(site, changedPayload),
          })
          .returning();
        return { status: 201 as const, request };
      });
      if (outcome.status !== 201) {
        res.status(outcome.status).json({
          error:
            "error" in outcome ? outcome.error : "Объект не найден",
        });
        return;
      }
      res
        .status(201)
        .json(
          CreateSiteChangeRequestResponse.parse(
            toChangeRequestDto(outcome.request),
          ),
        );
    } catch (error) {
      if (hasPostgresCode(error, "23505")) {
        res.status(409).json({
          error: "У вас уже есть ожидающее предложение для этого объекта",
        });
        return;
      }
      throw error;
    }
  },
);

async function decideSiteChangeRequest(
  req: Request,
  res: Response,
  decision: "approved" | "rejected",
): Promise<void> {
  const actor = req.appUser;
  if (!actor) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const schema =
    decision === "approved"
      ? ApproveSiteChangeRequestParams
      : RejectSiteChangeRequestParams;
  const params = schema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  let outcome:
    | { status: 200; request: typeof siteChangeRequestsTable.$inferSelect }
    | { status: 400 | 404 | 409; error?: string };
  try {
    outcome = await db.transaction(async (tx) => {
      await lockSiteClientWrites(tx);
      const [request] = await tx
        .select()
        .from(siteChangeRequestsTable)
        .where(eq(siteChangeRequestsTable.id, params.data.id))
        .for("update");
      if (!request) return { status: 404 as const };
      if (request.status !== "pending") return { status: 409 as const };
      if (!request.siteId && decision === "approved") {
        return {
          status: 409 as const,
          error: "Объект удалён, предложение больше нельзя применить",
        };
      }

      const [site] = request.siteId
        ? await tx
            .select()
            .from(sitesTable)
            .where(eq(sitesTable.id, request.siteId))
            .for("update")
        : [];

      let siteUpdateValues: Record<string, unknown> | null = null;
      if (decision === "approved") {
        if (!site) return { status: 404 as const };
        if (siteChangedSinceProposal(site, request.originalPayload)) {
          return {
            status: 409 as const,
            error:
              "Объект изменился после отправки предложения. Проверьте актуальные данные и отклоните устаревшее предложение",
          };
        }
        const payload = request.payload;
        if (payload.customer !== undefined) {
          const unknown = await findUnknownTradeNames([payload.customer], tx);
          if (unknown.length) {
            return { status: 400 as const, error: tradeNameError(unknown) };
          }
        }
        if (payload.deliveryType !== undefined) {
          const unknown = await findUnknownDeliveryTypes(
            [payload.deliveryType],
            tx,
          );
          if (unknown.length) {
            return { status: 400 as const, error: deliveryTypeError(unknown) };
          }
        }
        if (
          payload.driverUserId !== undefined &&
          (await loadDriverUsers([payload.driverUserId], tx)).invalidIds.length
        ) {
          return {
            status: 400 as const,
            error: "Выбранный пользователь не является водителем",
          };
        }
        const updateValues: Record<string, unknown> = { ...payload };
        if (payload.customer !== undefined) {
          updateValues.customer = payload.customer.trim();
        }
        if (payload.deliveryType !== undefined) {
          updateValues.deliveryType = payload.deliveryType.trim();
        }
        if (payload.clientId !== undefined) {
          const resolved = await resolveClient(tx, payload.clientId);
          if ("error" in resolved) {
            return { status: 400 as const, error: resolved.error };
          }
          updateValues.clientId = resolved.client.id;
          updateValues.client = resolved.client.name;
        }
        if (payload.name !== undefined) {
          const [duplicate] = await tx
            .select({ id: sitesTable.id })
            .from(sitesTable)
            .where(eq(sitesTable.name, payload.name));
          if (duplicate && duplicate.id !== site.id) {
            return {
              status: 409 as const,
              error: "Объект с таким названием уже существует",
            };
          }
        }
        siteUpdateValues = updateValues;
      }

      const [updatedRequest] = await tx
        .update(siteChangeRequestsTable)
        .set({
          status: decision,
          decidedAt: new Date(),
          decidedByUserId: actor.id,
          decidedByName: actor.name || actor.email,
          decidedByEmail: actor.email,
        })
        .where(
          and(
            eq(siteChangeRequestsTable.id, request.id),
            eq(siteChangeRequestsTable.status, "pending"),
          ),
        )
        .returning();
      if (!updatedRequest) return { status: 409 as const };
      if (siteUpdateValues) {
        await tx
          .update(sitesTable)
          .set(siteUpdateValues)
          .where(eq(sitesTable.id, site.id));
      }
      return { status: 200 as const, request: updatedRequest };
    });
  } catch (error) {
    if (hasPostgresCode(error, "23505")) {
      outcome = {
        status: 409,
        error: "Объект с таким названием уже существует",
      };
    } else if (hasPostgresCode(error, "23503")) {
      outcome = {
        status: 409,
        error:
          "Связанные данные изменились. Проверьте клиента или водителя и повторите решение",
      };
    } else {
      throw error;
    }
  }
  if (outcome.status !== 200) {
    res.status(outcome.status).json({
      error:
        "error" in outcome
          ? outcome.error
          : outcome.status === 409
            ? "Предложение уже обработано"
            : "Предложение или объект не найдены",
    });
    return;
  }
  const responseSchema =
    decision === "approved"
      ? ApproveSiteChangeRequestResponse
      : RejectSiteChangeRequestResponse;
  res.json(
    responseSchema.parse(
      toChangeRequestDto(outcome.request),
    ),
  );
}

router.post(
  "/site-change-requests/:id/approve",
  requireAdmin,
  (req, res) => decideSiteChangeRequest(req, res, "approved"),
);
router.post(
  "/site-change-requests/:id/reject",
  requireAdmin,
  (req, res) => decideSiteChangeRequest(req, res, "rejected"),
);

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

router.patch("/sites/:id/features", async (req, res): Promise<void> => {
  const params = UpdateSiteFeaturesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateSiteFeaturesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = req.appUser;
  if (
    !user ||
    (user.role !== "admin" &&
      !(
        user.role === "logistician" &&
        user.editableSections.includes("sites")
      ))
  ) {
    res.status(403).json({
      error: "Недостаточно прав для изменения поля «Особенности»",
    });
    return;
  }
  const [site] = await db
    .update(sitesTable)
    .set({ features: parsed.data.features.trim() })
    .where(eq(sitesTable.id, params.data.id))
    .returning();
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  res.json(
    UpdateSiteFeaturesResponse.parse(
      toSiteDto(site, await getDriverName(site.driverUserId)),
    ),
  );
});

router.patch("/sites/:id", requirePermission("sites"), async (req, res): Promise<void> => {
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
  if (parsed.data.manager !== undefined) updateValues.manager = parsed.data.manager;
  if (parsed.data.managerContact !== undefined) updateValues.managerContact = parsed.data.managerContact;
  if (parsed.data.director !== undefined) updateValues.director = parsed.data.director;
  if (parsed.data.project !== undefined) updateValues.project = parsed.data.project;
  if (parsed.data.driverUserId !== undefined) updateValues.driverUserId = parsed.data.driverUserId;
  if (parsed.data.deliveryType !== undefined) updateValues.deliveryType = parsed.data.deliveryType.trim();
  if (parsed.data.features !== undefined) updateValues.features = parsed.data.features.trim();

  let outcome;
  try {
    outcome = await db.transaction(async (tx) => {
      await lockSiteClientWrites(tx);
      const [currentSite] = await tx
        .select()
        .from(sitesTable)
        .where(eq(sitesTable.id, params.data.id));
      if (!currentSite) return { status: 404 as const };

      if (parsed.data.name) {
        const [existing] = await tx
          .select({ id: sitesTable.id })
          .from(sitesTable)
          .where(eq(sitesTable.name, parsed.data.name));
        if (existing && existing.id !== params.data.id) {
          return {
            status: 409 as const,
            error: "Объект с таким названием уже существует",
          };
        }
      }
      if (parsed.data.clientId !== undefined) {
        const resolvedClient = await resolveClient(tx, parsed.data.clientId);
        if ("error" in resolvedClient) {
          return { status: 400 as const, error: resolvedClient.error };
        }
        updateValues.client = resolvedClient.client.name;
        updateValues.clientId = resolvedClient.client.id;
      }
      if (Object.keys(updateValues).length === 0) {
        return { status: 200 as const, site: currentSite };
      }
      const [site] = await tx
        .update(sitesTable)
        .set(updateValues)
        .where(eq(sitesTable.id, params.data.id))
        .returning();
      return { status: 200 as const, site };
    });
  } catch (error) {
    if (
      hasPostgresConstraint(
        error,
        "sites_driver_user_id_app_users_id_fk",
      )
    ) {
      res.status(400).json({ error: "Выбранный пользователь не является водителем" });
      return;
    }
    throw error;
  }

  if (outcome.status === 404) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  if (outcome.status !== 200) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }

  res.json(UpdateSiteResponse.parse(
    toSiteDto(outcome.site, await getDriverName(outcome.site.driverUserId)),
  ));
});

router.post("/sites/:id/close", requireAdmin, async (req, res): Promise<void> => {
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

router.post("/sites/:id/reopen", requireAdmin, async (req, res): Promise<void> => {
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

router.delete("/sites/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteSiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    await lockSiteClientWrites(tx);
    const [pendingRequest] = await tx
      .select({ id: siteChangeRequestsTable.id })
      .from(siteChangeRequestsTable)
      .where(
        and(
          eq(siteChangeRequestsTable.siteId, params.data.id),
          eq(siteChangeRequestsTable.status, "pending"),
        ),
      );
    if (pendingRequest) return { status: 409 as const };
    const [site] = await tx
      .delete(sitesTable)
      .where(eq(sitesTable.id, params.data.id))
      .returning();
    return site ? { status: 204 as const } : { status: 404 as const };
  });
  if (outcome.status === 409) {
    res.status(409).json({
      error:
        "Сначала примите или отклоните ожидающие предложения по этому объекту",
    });
    return;
  }
  if (outcome.status === 404) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
