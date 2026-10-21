import { excelSerialToIsoDate, str } from "./excel-import.ts";

export type ScheduleReviewRowInput = {
  row: number;
  siteName: string;
  driverName: string;
  plannedDate: string | null;
};

export const SCHEDULE_REVIEW_SITE_HEADERS = ["Объект", "Магазин"];
export const SCHEDULE_REVIEW_REQUIRED_HEADERS = ["Водитель", "Плановая дата"];

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Normalizes an Excel planned date. Blank -> null. Valid -> YYYY-MM-DD.
 * Invalid non-blank values are returned unchanged (never null) so the server
 * reports a conflict instead of silently clearing the plan.
 */
export function normalizeSchedulePlannedDate(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return String(raw);
    const iso = excelSerialToIsoDate(raw);
    return isIsoCalendarDate(iso) ? iso : String(raw);
  }
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? String(raw) : raw.toISOString().slice(0, 10);
  }
  const text = str(raw);
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  if (ru) {
    const iso = `${ru[3]}-${ru[2].padStart(2, "0")}-${ru[1].padStart(2, "0")}`;
    return isIsoCalendarDate(iso) ? iso : text;
  }
  if (isIsoCalendarDate(text)) return text;
  return text;
}

function findKey(row: Record<string, unknown>, header: string): string | undefined {
  const target = header.trim().toLowerCase();
  return Object.keys(row).find((key) => key.trim().toLowerCase() === target);
}

export function findScheduleHeaderProblems(headers: string[]): string[] {
  const set = new Set(headers.map((h) => h.trim().toLowerCase()));
  const missing: string[] = [];
  if (!SCHEDULE_REVIEW_SITE_HEADERS.some((h) => set.has(h.toLowerCase()))) {
    missing.push("Объект или Магазин");
  }
  for (const h of SCHEDULE_REVIEW_REQUIRED_HEADERS) {
    if (!set.has(h.toLowerCase())) missing.push(h);
  }
  return missing;
}

/** Only site, driver and planned date are read. All other columns (Факт.дата, акты, комментарии) are ignored. */
export function buildScheduleReviewRows(
  rows: Record<string, unknown>[],
): ScheduleReviewRowInput[] {
  const result: ScheduleReviewRowInput[] = [];
  rows.forEach((row, index) => {
    const rowNum = (row as { __rowNum__?: unknown }).__rowNum__;
    const excelRow = typeof rowNum === "number" ? rowNum + 1 : index + 2;
    const siteKey =
      findKey(row, "Объект") ?? findKey(row, "Магазин");
    const driverKey = findKey(row, "Водитель");
    const dateKey = findKey(row, "Плановая дата");
    const siteName = siteKey ? str(row[siteKey]) : "";
    const driverName = driverKey ? str(row[driverKey]) : "";
    const plannedDate = dateKey ? normalizeSchedulePlannedDate(row[dateKey]) : null;
    if (!siteName && !driverName && plannedDate === null) return;
    result.push({ row: Math.max(2, excelRow), siteName, driverName, plannedDate });
  });
  return result;
}
