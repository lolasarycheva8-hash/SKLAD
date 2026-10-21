// Pure helpers for the Склад XLSX import (contract: /api/inventory-records). No API/DOM deps.

export type StockKind = "equipment" | "consumables" | "spare_parts";

export const STOCK_KINDS: { kind: StockKind; label: string; keyLabel: string; file: string }[] = [
  { kind: "equipment", label: "Техника", keyLabel: "Инвентарный номер", file: "склад-техника-шаблон.xlsx" },
  { kind: "consumables", label: "Расходные материалы", keyLabel: "Артикул", file: "склад-расходники-шаблон.xlsx" },
  { kind: "spare_parts", label: "Запчасти", keyLabel: "Артикул", file: "склад-запчасти-шаблон.xlsx" },
];

export const CONDITIONS = ["Новое", "Хорошее", "Удовлетворительное", "Требует ремонта", "Неисправно"];
export const STATUSES = ["На складе", "На объекте", "В ремонте", "Списано"];
export const DEFAULT_UNIT: Record<StockKind, string> = { equipment: "шт", consumables: "шт", spare_parts: "шт" };

export type SiteRef = { id: string; name: string };

export type StockRecordInput = {
  kind: StockKind;
  name: string;
  type: string | null;
  model: string | null;
  inventoryNumber: string | null;
  sku: string | null;
  quantity: number;
  unit: string;
  condition: string;
  status: string;
  siteId: string | null;
  notes: string | null;
};

export type StockImportRow = StockRecordInput & { rowNumber: number };
export type StockImportError = { rowNumber: number | null; message: string };

export function kindMeta(kind: StockKind) {
  return STOCK_KINDS.find((k) => k.kind === kind)!;
}

export function templateHeaders(kind: StockKind): string[] {
  return ["Наименование", "Тип", "Модель", kindMeta(kind).keyLabel, "Количество", "Ед. изм.", "Состояние", "Статус", "Объект", "Примечание"];
}

const norm = (v: string) => v.replace(/\s+/g, " ").trim().toLowerCase();
const s = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

export function validateStockRows(
  kind: StockKind,
  rows: Record<string, unknown>[],
  headers: string[],
  sites: SiteRef[],
  existingKeys: string[] = [],
): { rows: StockImportRow[]; errors: StockImportError[] } {
  const expected = templateHeaders(kind);
  const present = new Set(headers.map(norm));
  const missing = expected.filter((h) => !present.has(norm(h)));
  if (missing.length) {
    return { rows: [], errors: [{ rowNumber: null, message: `Не найдены столбцы: ${missing.join(", ")}. Скачайте шаблон этой вкладки.` }] };
  }
  const [hName, hType, hModel, hKey, hQty, hUnit, hCond, hStatus, hSite, hNotes] = expected;
  const errors: StockImportError[] = [];
  const out: StockImportRow[] = [];
  const seen = new Map<string, number>();
  const existing = new Set(existingKeys.map(norm));
  const siteIndex = new Map<string, SiteRef[]>();
  for (const site of sites) {
    const k = norm(site.name);
    siteIndex.set(k, [...(siteIndex.get(k) ?? []), site]);
  }
  const pick = (list: string[], v: string) => list.find((c) => norm(c) === norm(v)) ?? null;

  rows.forEach((raw, i) => {
    const rowNumber = i + 2;
    const get = (h: string) => {
      const found = Object.keys(raw).find((k) => norm(k) === norm(h));
      return found ? s(raw[found]) : "";
    };
    if (expected.every((h) => get(h) === "")) return;
    const err = (message: string) => errors.push({ rowNumber, message });
    const name = get(hName);
    const key = get(hKey);
    if (!name) err("не заполнено наименование");
    if (!key) err(`не заполнен столбец «${hKey}»`);
    const qtyRaw = get(hQty);
    let quantity = Number(qtyRaw.replace(",", "."));
    if (kind === "equipment" && qtyRaw === "") quantity = 1;
    else if (qtyRaw === "") { err("не заполнено количество"); quantity = 0; }
    else if (!Number.isFinite(quantity)) { err(`количество «${qtyRaw}» не число`); quantity = 0; }
    else if (quantity < 0) err("количество не может быть отрицательным");
    else if (kind === "equipment" && quantity !== 1) err("для техники количество должно быть 1");
    const condRaw = get(hCond);
    const condition = condRaw ? pick(CONDITIONS, condRaw) : CONDITIONS[0];
    if (!condition) err(`неизвестное состояние «${condRaw}»`);
    const statusRaw = get(hStatus);
    const status = statusRaw ? pick(STATUSES, statusRaw) : STATUSES[0];
    if (!status) err(`неизвестный статус «${statusRaw}»`);
    const siteRaw = get(hSite);
    let siteId: string | null = null;
    if (siteRaw) {
      const matches = siteIndex.get(norm(siteRaw)) ?? [];
      if (matches.length === 0) err(`объект «${siteRaw}» не найден`);
      else if (matches.length > 1) err(`объект «${siteRaw}» неоднозначен (${matches.length} совпадения)`);
      else siteId = matches[0].id;
    }
    if (key) {
      const prev = seen.get(norm(key));
      if (prev) err(`дубликат «${key}» (уже в строке ${prev})`);
      else seen.set(norm(key), rowNumber);
      if (existing.has(norm(key))) err(`«${key}» уже есть на складе`);
    }
    out.push({
      rowNumber, kind, name, quantity,
      condition: condition ?? "", status: status ?? "", siteId,
      type: get(hType) || null, model: get(hModel) || null,
      inventoryNumber: kind === "equipment" ? key || null : null,
      sku: kind === "equipment" ? null : key || null,
      unit: get(hUnit) || DEFAULT_UNIT[kind], notes: get(hNotes) || null,
    });
  });
  if (!errors.length && !out.length) errors.push({ rowNumber: null, message: "В файле нет строк для импорта" });
  if (out.length > 1000) errors.push({ rowNumber: null, message: "Не более 1000 строк за один импорт" });
  return { rows: errors.length ? [] : out, errors };
}

/** Map server bulk errors ({row 1-based data row, field, error}) to sheet row numbers. */
export function serverBulkErrors(err: unknown): StockImportError[] {
  const data = (err as { data?: unknown })?.data as { error?: string; errors?: { row: number; field: string; error: string }[] } | undefined;
  const list = data?.errors ?? [];
  if (list.length) return list.map((e) => ({ rowNumber: e.row + 1, message: `${e.field ? e.field + ": " : ""}${e.error}` }));
  return [{ rowNumber: null, message: data?.error ?? (err as Error)?.message ?? "Не удалось импортировать" }];
}
