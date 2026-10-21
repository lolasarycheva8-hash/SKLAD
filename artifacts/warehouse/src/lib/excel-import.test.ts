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
  assert.match(templateXml, /sqref="B2:B1048576"/);
  assert.match(templateXml, /errorStyle="stop"/);
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

test("шаблон объектов содержит точные названия компаний и обязательный список клиентов", () => {
  const names = ['ООО «Компания А»', 'Компания & Б'];
  const bytes = buildTemplateWorkbook(["Название", "Клиент"], [{
    name: "Справочник клиентов",
    headers: ["Название клиента"],
    rows: names.map((name) => ({ "Название клиента": name })),
    dropdownForHeader: "Клиент",
    allowBlank: false,
  }]);
  const archive = XLSX.CFB.read(bytes, { type: "buffer" });
  const xml = readArchiveXml(archive, "Root Entry/xl/worksheets/sheet1.xml");
  assert.match(xml, /sqref="B2:B1048576"/);
  assert.match(xml, /allowBlank="0"/);
  const workbook = XLSX.read(bytes, { type: "array" });
  assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets["Справочник клиентов"]),
    names.map((name) => ({ "Название клиента": name })));
});

test("шаблон товаров содержит выпадающие категории во всех строках и сохраняет заголовки", () => {
  const headers = ["Название", "Артикул", "Ед. измерения", "Цена закупочная",
    "Цена продажная", "Категория", "Мин. остаток", "Начальный остаток",
    "Поставщик", "Контакт поставщика"];
  const names = ["Инвентарь", "Моющие средства", 'Средства "А" & Б'];
  const bytes = buildTemplateWorkbook(headers, [{
    name: "Справочник категорий",
    headers: ["Категория"],
    rows: names.map((name) => ({ Категория: name })),
    dropdownForHeader: "Категория",
    dropdownError: "Выберите категорию из выпадающего списка.",
    hidden: true,
  }]);
  const archive = XLSX.CFB.read(bytes, { type: "buffer" });
  const xml = readArchiveXml(archive, "Root Entry/xl/worksheets/sheet1.xml");
  const workbookXml = readArchiveXml(archive, "Root Entry/xl/workbook.xml");
  assert.match(xml, /sqref="F2:F1048576"/);
  assert.match(xml, /<formula1>_TemplateOptions1<\/formula1>/);
  assert.match(xml, /Выберите категорию из выпадающего списка/);
  assert.doesNotMatch(xml, /водител/);
  assert.match(workbookXml, /name="Справочник категорий" state="hidden"/);
  assert.match(workbookXml, /'Справочник категорий'!\$A\$2:\$A\$4/);
  const workbook = XLSX.read(bytes, { type: "array" });
  assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets["Шаблон"], { header: 1 }), [headers]);
  assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets["Справочник категорий"]),
    names.map((name) => ({ Категория: name })));
});