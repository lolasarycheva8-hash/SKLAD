import assert from "node:assert/strict";
import test from "node:test";

import * as XLSX from "xlsx";

import { buildTemplateWorkbook } from "./excel-import.ts";

function readArchiveXml(
  archive: ReturnType<typeof XLSX.CFB.read>,
  path: string,
): string {
  const entry = XLSX.CFB.find(archive, path);
  assert.ok(entry, `Не найден ${path}`);
  return new TextDecoder().decode(entry.content);
}

test("шаблон создаёт Excel-список водителей без колонки email", () => {
  const bytes = buildTemplateWorkbook(
    ["Название", "Водитель", "Тип поставки"],
    [
      {
        name: "Справочник водителей",
        headers: ["Водитель"],
        rows: [
          { Водитель: "Иван Иванов" },
          { Водитель: "Пётр Петров" },
        ],
        dropdownForHeader: "Водитель",
        hidden: true,
      },
    ],
  );
  const archive = XLSX.CFB.read(bytes, { type: "buffer" });
  const templateXml = readArchiveXml(
    archive,
    "Root Entry/xl/worksheets/sheet1.xml",
  );
  const workbookXml = readArchiveXml(
    archive,
    "Root Entry/xl/workbook.xml",
  );

  assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  assert.match(templateXml, /sqref="B2:B1000"/);
  assert.match(templateXml, /<formula1>_TemplateOptions1<\/formula1>/);
  assert.doesNotMatch(templateXml, /Email водителя/);
  assert.match(
    workbookXml,
    /name="Справочник водителей" state="hidden"/,
  );
  assert.match(
    workbookXml,
    /'Справочник водителей'!\$A\$2:\$A\$3/,
  );
});