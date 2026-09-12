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
  dropdownForHeader?: string;
  hidden?: boolean;
};

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function replaceZipEntry(
  archive: ReturnType<typeof XLSX.CFB.read>,
  path: string,
  update: (xml: string) => string,
) {
  const entry = XLSX.CFB.find(archive, path);
  if (!entry) {
    throw new Error(`Не найден внутренний файл Excel: ${path}`);
  }
  const nextContent = new TextEncoder().encode(
    update(new TextDecoder().decode(entry.content)),
  );
  entry.content = nextContent;
  entry.size = nextContent.byteLength;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function excelSheetReference(name: string): string {
  return `'${name.replaceAll("'", "''")}'`;
}

export function buildTemplateWorkbook(
  headers: string[],
  referenceSheets: TemplateReferenceSheet[] = [],
): Uint8Array {
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

  const initialBytes = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  }) as ArrayBuffer;
  const archive = XLSX.CFB.read(new Uint8Array(initialBytes), {
    type: "buffer",
  });
  const dropdownSheets = referenceSheets
    .map((reference, index) => ({ reference, sheetIndex: index + 2 }))
    .filter(({ reference }) => reference.dropdownForHeader);

  if (dropdownSheets.length === 0) {
    return new Uint8Array(initialBytes);
  }

  const validations: string[] = [];
  const definedNames: string[] = [];
  for (const [index, { reference }] of dropdownSheets.entries()) {
    const targetColumnIndex = headers.indexOf(reference.dropdownForHeader!);
    if (targetColumnIndex < 0) continue;

    const definedName = `_TemplateOptions${index + 1}`;
    const targetColumn = XLSX.utils.encode_col(targetColumnIndex);
    const optionCount = Math.max(reference.rows.length, 1);
    const referenceColumn = XLSX.utils.encode_col(0);
    const sheetName = reference.name.slice(0, 31);
    definedNames.push(
      `<definedName name="${definedName}">${excelSheetReference(sheetName)}!$${referenceColumn}$2:$${referenceColumn}$${optionCount + 1}</definedName>`,
    );
    validations.push(
      `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Неверный водитель" error="Выберите водителя из выпадающего списка." sqref="${targetColumn}2:${targetColumn}1000"><formula1>${definedName}</formula1></dataValidation>`,
    );
  }

  replaceZipEntry(
    archive,
    "Root Entry/xl/worksheets/sheet1.xml",
    (xml) =>
      xml.replace(
        "<ignoredErrors>",
        `<dataValidations count="${validations.length}">${validations.join("")}</dataValidations><ignoredErrors>`,
      ),
  );
  replaceZipEntry(archive, "Root Entry/xl/workbook.xml", (xml) => {
    let updated = xml.replace(
      "</workbook>",
      `<definedNames>${definedNames.join("")}</definedNames></workbook>`,
    );
    for (const { reference } of dropdownSheets) {
      if (!reference.hidden) continue;
      const sheetName = xmlEscape(reference.name.slice(0, 31));
      updated = updated.replace(
        `<sheet name="${sheetName}"`,
        `<sheet name="${sheetName}" state="hidden"`,
      );
    }
    return updated;
  });

  return XLSX.CFB.write(archive, {
    type: "buffer",
    fileType: "zip",
  } as Parameters<typeof XLSX.CFB.write>[1]) as Uint8Array;
}

export function downloadTemplate(
  headers: string[],
  filename: string,
  referenceSheets: TemplateReferenceSheet[] = [],
) {
  const bytes = buildTemplateWorkbook(headers, referenceSheets);
  const fileBuffer = new Uint8Array(bytes.byteLength);
  fileBuffer.set(bytes);
  const url = URL.createObjectURL(
    new Blob([fileBuffer.buffer], { type: XLSX_MIME }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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

export function exportRowsToEditableCsv(
  rows: Record<string, unknown>[],
  headers: string[],
  filename: string,
) {
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  const csv = XLSX.utils.sheet_to_csv(worksheet, { FS: ";" });
  const url = URL.createObjectURL(
    new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
