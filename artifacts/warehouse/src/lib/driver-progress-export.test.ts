import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { buildDriverProgressWorkbook } from "./driver-progress-export.ts";
import { formatDriverProgressWorkbook } from "./driver-progress-format.ts";

const drivers = [
  { id: "a", name: "Водитель", email: "a@example.test" },
  { id: "b", name: "Водитель", email: "b@example.test" },
  { id: "idle", name: "Без доставок", email: "idle@example.test" },
];
const rows = [
  { driverUserId: "a", driver: "Водитель", plannedDate: "2026-10-01", actualDate: "2026-10-02", workflowStatus: "closed", actApprovedAt: "2026-10-02T09:00:00Z" },
  { driverUserId: "a", driver: "Водитель", plannedDate: "2026-10-20", actualDate: "2026-10-03", workflowStatus: "done" },
  { driverUserId: "b", driver: "Водитель", plannedDate: "2026-10-02", actualDate: null },
  { driverUserId: null, driver: "", plannedDate: "2026-10-03", actualDate: null },
  { driverUserId: "a", driver: "Водитель", plannedDate: "2026-10-01", actualDate: null, archivedAt: "2026-10-02" },
  { driverUserId: "a", driver: "Водитель", plannedDate: null, actualDate: null },
  { driverUserId: "a", driver: "Водитель", plannedDate: "2026-09-01", actualDate: null },
];

test("Excel roundtrip keeps driver IDs separate, totals correct and percentages numeric", () => {
  const workbook = buildDriverProgressWorkbook(rows, drivers, "2026-10", "2026-10-04");
  const bytes = formatDriverProgressWorkbook(workbook);
  const reopened = XLSX.read(bytes, { type: "array", cellNF: true });
  const sheet = reopened.Sheets["Сводка по водителям"];
  const data = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
  assert.equal(data.filter(row => row[0] === "Водитель" && typeof row[1] === "number").length, 2);
  assert.deepEqual(data[4], ["Водитель", 1, 1, 2, 2, 1, 1, 2, 1, 2, 1, 1, 0.5]);
  assert.equal(data.some(row => row[0] === "Без доставок"), false);
  assert.deepEqual(data.at(-1), ["ИТОГО", 3, 1, 2, 2 / 3, 1, 1 / 3, 4, 1, 2, 0.5, 1, 0.25]);
  assert.equal(data[6][0], "Не назначен");
  assert.equal(sheet.K5.t, "n");
  assert.equal(sheet.K5.z, "0.0%");
  assert.equal(sheet["!merges"]?.length, 4);
  assert.equal(reopened.SheetNames.includes("Пояснения"), true);
  const archive = XLSX.CFB.read(bytes, { type: "buffer" });
  const xml = (path: string) => new TextDecoder().decode(XLSX.CFB.find(archive, `/${path}`)!.content);
  const sheetXml = xml("xl/worksheets/sheet1.xml");
  const styles = xml("xl/styles.xml");
  assert.match(sheetXml, /xSplit="1" ySplit="4" topLeftCell="B5"/);
  assert.match(sheetXml, /width="34.5"/);
  assert.match(sheetXml, /width="12.5"/);
  assert.match(sheetXml, /<c r="B6" s="10">/); // Below period plan: red.
  assert.match(sheetXml, /<c r="B5" s="5">/); // Period ahead of plan: black.
  assert.match(sheetXml, /<c r="B8" s="5">/); // Totals aren't flagged as a driver.
  assert.match(styles, /FFEBF1DE/);
  assert.match(styles, /FFDBEEF3/);
  assert.match(styles, /FFFF0000/);
  assert.match(styles, /wrapText="1"/);
  assert.equal(data[2][1], "За период — % от плана периода");
  assert.equal(data[2][7], "Итоги месяца — % от плана месяца");
});

test("empty and future reports contain totals and no fabricated percentage", () => {
  const empty = buildDriverProgressWorkbook([], drivers, "2026-10", "2026-10-04");
  const emptyData = XLSX.utils.sheet_to_json<(string | number)[]>(empty.Sheets["Сводка по водителям"], { header: 1 });
  assert.deepEqual(emptyData.at(-1), ["ИТОГО", 0, "—", 0, "—", 0, "—", 0, "—", 0, "—", 0, "—"]);
  assert.equal(emptyData.length, 5);
  const future = buildDriverProgressWorkbook(rows, drivers, "2026-10", "2026-09-30");
  const futureData = XLSX.utils.sheet_to_json<(string | number)[]>(future.Sheets["Сводка по водителям"], { header: 1 });
  assert.match(String(futureData[1][0]), /Месяц ещё не начался/);
  assert.deepEqual(futureData.at(-1)?.slice(1, 7), [0, "—", 0, "—", 0, "—"]);
});

test("keeps future plans without fact, excludes drivers with only archived or other-month deliveries", () => {
  const workbook = buildDriverProgressWorkbook([
    { driverUserId: "a", driver: "Водитель", plannedDate: "2026-10-30", actualDate: null },
    { driverUserId: "b", driver: "Водитель", plannedDate: "2026-10-01", actualDate: "2026-10-02", archivedAt: "2026-10-03" },
    { driverUserId: "idle", driver: "Без доставок", plannedDate: "2026-09-01", actualDate: "2026-09-02" },
  ], drivers, "2026-10", "2026-10-04");
  const data = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets["Сводка по водителям"], { header: 1 });
  assert.equal(data.length, 6); // Four header rows, one driver and total.
  assert.equal(data[4][0], "Водитель");
  assert.equal(data[4][1], 0); // No plan before yesterday.
  assert.equal(data[4][7], 1); // But a monthly assignment exists.
  assert.deepEqual(data[4].slice(1), data[5].slice(1));
});