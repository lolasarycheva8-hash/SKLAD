import * as XLSX from "xlsx";

export async function parseExcelFile(file: File): Promise<Record<string, unknown>[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

export async function readSheetHeaders(file: File): Promise<string[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  const headerRow = rows[0] ?? [];
  return headerRow.map((h) => str(h));
}

export function validateTemplateHeaders(actual: string[], expected: string[]): string[] {
  const actualSet = new Set(actual.map((h) => h.trim().toLowerCase()));
  return expected.filter((h) => !actualSet.has(h.trim().toLowerCase()));
}

type TemplateReferenceSheet = {
  name: string;
  rows: Record<string, unknown>[];
  headers: string[];
};

export function downloadTemplate(
  headers: string[],
  filename: string,
  referenceSheets: TemplateReferenceSheet[] = [],
) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Шаблон");
  for (const reference of referenceSheets) {
    const referenceWorksheet = XLSX.utils.json_to_sheet(reference.rows, {
      header: reference.headers,
    });
    XLSX.utils.book_append_sheet(
      workbook,
      referenceWorksheet,
      reference.name.slice(0, 31),
    );
  }
  XLSX.writeFile(workbook, filename);
}

export function exportRowsToExcel(
  rows: Record<string, unknown>[],
  headers: string[],
  filename: string,
) {
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Данные");
  XLSX.writeFile(workbook, filename);
}

export function str(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export function num(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function excelSerialToIsoDate(value: unknown): string {
  if (typeof value === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(epoch.getTime() + value * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const s = str(value);
  if (!s) return "";
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return s;
}
