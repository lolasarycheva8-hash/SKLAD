import { eq, inArray, sql } from "drizzle-orm";
import { db, inventoryRecordsTable, sitesTable, type InventoryRecord } from "@workspace/db";
import type { InventoryRecordInput, InventoryRecordRowError } from "@workspace/api-zod";
import { isPostgresConstraintError } from "./postgres-errors";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class InventoryRecordError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errors: InventoryRecordRowError[] = [],
  ) {
    super(message);
  }
}

export function normalizeInventoryRecord(input: InventoryRecordInput): InventoryRecordInput {
  return {
    ...input,
    name: input.name.trim(),
    unit: input.unit.trim(),
    condition: input.condition.trim(),
    status: input.status.trim(),
    type: input.type?.trim() ?? null,
    model: input.model?.trim() ?? null,
    inventoryNumber: input.inventoryNumber?.trim() ?? null,
    sku: input.sku?.trim() ?? null,
    siteId: input.siteId?.toLowerCase() ?? null,
    notes: input.notes ?? null,
  };
}

function identityField(row: InventoryRecordInput): "inventoryNumber" | "sku" {
  return row.kind === "equipment" ? "inventoryNumber" : "sku";
}

function rowErrors(rows: InventoryRecordInput[]): InventoryRecordRowError[] {
  const errors: InventoryRecordRowError[] = [];
  rows.forEach((row, index) => {
    for (const field of ["name", "unit", "condition", "status"] as const) {
      if (!row[field]) errors.push({ row: index + 1, field, error: "Обязательное поле не может быть пустым" });
    }
    const field = identityField(row);
    if (!row[field]) errors.push({ row: index + 1, field, error: "Требуется идентификатор позиции" });
    if (row.kind === "equipment" && row.quantity !== 1) {
      errors.push({ row: index + 1, field: "quantity", error: "Оборудование учитывается поштучно: количество должно быть 1" });
    }
  });
  return errors;
}

// Serialize record mutations, including concurrent imports, before checking
// duplicates. Unique indexes remain the final boundary for external writers.
async function lockRecords(tx: Transaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(719004211)`);
}

async function validateSites(tx: Transaction, rows: InventoryRecordInput[]): Promise<InventoryRecordRowError[]> {
  const ids = [...new Set(rows.flatMap((row) => row.siteId ? [row.siteId] : []))].sort();
  if (!ids.length) return [];
  // SHARE blocks both deletion and archival until the inventory transaction
  // commits. Acquire in a stable order to avoid multi-site import deadlocks.
  const sites = await tx.select().from(sitesTable)
    .where(inArray(sitesTable.id, ids)).orderBy(sitesTable.id).for("share");
  const sitesById = new Map(sites.map((site) => [site.id, site]));
  return rows.flatMap((row, index) => {
    if (!row.siteId) return [];
    const site = sitesById.get(row.siteId);
    if (!site || site.closedFrom !== null) {
      return [{ row: index + 1, field: "siteId", error: site ? "Архивный объект недоступен" : "Объект не найден" }];
    }
    return [];
  });
}

async function duplicateErrors(
  tx: Transaction,
  rows: InventoryRecordInput[],
  excludeId?: string,
): Promise<InventoryRecordRowError[]> {
  // Compare identifiers using Postgres lower(), consistently with the indexes
  // (not JavaScript's potentially different Unicode lowercasing).
  const identifiers = rows.map((row, index) =>
    sql`(${index + 1}::integer, ${row.kind}::text, lower(${row[identityField(row)]}::text))`,
  );
  const result = await tx.execute<{ row: number; existing: boolean; repeated: boolean }>(sql`
    with incoming(row, kind, identifier) as (values ${sql.join(identifiers, sql`, `)})
    select incoming.row,
      exists(
        select 1 from ${inventoryRecordsTable} as existing
        where existing.kind = incoming.kind
          and lower(btrim(case when existing.kind = 'equipment' then existing.inventory_number else existing.sku end)) = incoming.identifier
          and (${excludeId ?? null}::uuid is null or existing.id <> ${excludeId ?? null}::uuid)
      ) as existing,
      (select count(*) > 1 from incoming as other
       where other.kind = incoming.kind and other.identifier = incoming.identifier) as repeated
    from incoming
  `);
  return result.rows.flatMap((match) => match.existing || match.repeated
    ? [{ row: match.row, field: identityField(rows[match.row - 1]), error: match.existing ? "Идентификатор уже существует" : "Идентификатор повторяется в файле" }]
    : []);
}

function translateConstraint(error: unknown, rows: InventoryRecordInput[]): never {
  const duplicate = ["inventory_records_equipment_number_unique", "inventory_records_kind_sku_unique"]
    .some((constraint) => isPostgresConstraintError(error, { code: "23505", constraint }));
  if (duplicate) {
    throw new InventoryRecordError(409, "Идентификатор уже существует; импорт не выполнен",
      rows.map((row, index) => ({ row: index + 1, field: identityField(row), error: "Конфликт идентификатора с параллельной записью; проверьте строку и повторите" })));
  }
  throw error;
}

export async function createInventoryRecords(inputs: InventoryRecordInput[]): Promise<InventoryRecord[]> {
  const rows = inputs.map(normalizeInventoryRecord);
  const invalid = rowErrors(rows);
  if (invalid.length) throw new InventoryRecordError(400, "Исправьте ошибки в строках", invalid);
  try {
    return await db.transaction(async (tx) => {
      await lockRecords(tx);
      const invalidSites = await validateSites(tx, rows);
      const duplicates = await duplicateErrors(tx, rows);
      if (invalidSites.length || duplicates.length) {
        throw new InventoryRecordError(invalidSites.length ? 400 : 409, "Импорт не выполнен: исправьте ошибки в строках", [...invalidSites, ...duplicates]);
      }
      return tx.insert(inventoryRecordsTable).values(rows).returning();
    });
  } catch (error) {
    translateConstraint(error, rows);
  }
}

export async function updateInventoryRecord(id: string, patch: Partial<InventoryRecordInput>): Promise<InventoryRecord> {
  let rows: InventoryRecordInput[] = [];
  try {
    return await db.transaction(async (tx) => {
      await lockRecords(tx);
      const [existing] = await tx.select().from(inventoryRecordsTable).where(eq(inventoryRecordsTable.id, id)).for("update");
      if (!existing) throw new InventoryRecordError(404, "Позиция не найдена");
      const { id: _id, ...input } = existing;
      rows = [normalizeInventoryRecord({ ...input, ...patch })];
      const invalid = [...rowErrors(rows), ...await validateSites(tx, rows)];
      if (invalid.length) throw new InventoryRecordError(400, invalid[0].error, invalid);
      const duplicates = await duplicateErrors(tx, rows, id);
      if (duplicates.length) throw new InventoryRecordError(409, duplicates[0].error, duplicates);
      const [updated] = await tx.update(inventoryRecordsTable).set(rows[0]).where(eq(inventoryRecordsTable.id, id)).returning();
      return updated;
    });
  } catch (error) {
    translateConstraint(error, rows);
  }
}

export async function deleteInventoryRecord(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockRecords(tx);
    const [deleted] = await tx.delete(inventoryRecordsTable).where(eq(inventoryRecordsTable.id, id)).returning({ id: inventoryRecordsTable.id });
    if (!deleted) throw new InventoryRecordError(404, "Позиция не найдена");
  });
}