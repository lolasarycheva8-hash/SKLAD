import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScheduleReviewRows,
  findScheduleHeaderProblems,
  normalizeSchedulePlannedDate,
} from "./schedule-review-import.ts";

test("normalizes dates without turning invalid values into null", () => {
  assert.equal(normalizeSchedulePlannedDate(""), null);
  assert.equal(normalizeSchedulePlannedDate("   "), null);
  assert.equal(normalizeSchedulePlannedDate(undefined), null);
  assert.equal(normalizeSchedulePlannedDate("05.09.2026"), "2026-09-05");
  assert.equal(normalizeSchedulePlannedDate("2026-09-05"), "2026-09-05");
  assert.equal(normalizeSchedulePlannedDate(46270), "2026-09-05");
  assert.equal(normalizeSchedulePlannedDate("31.02.2026"), "31.02.2026");
  assert.equal(normalizeSchedulePlannedDate("завтра"), "завтра");
});

test("accepts Объект or Магазин header", () => {
  assert.deepEqual(findScheduleHeaderProblems(["Магазин", "Водитель", "Плановая дата"]), []);
  assert.deepEqual(findScheduleHeaderProblems(["Водитель"]), ["Объект или Магазин", "Плановая дата"]);
});

test("reads only site, driver, planned date and keeps Excel row numbers", () => {
  const rows = [
    { Магазин: " Лента 12 ", Водитель: "Петров", "Плановая дата": "05.09.2026", "Факт.дата": "06.09.2026" },
    { Магазин: "", Водитель: "", "Плановая дата": "" },
    { Магазин: "Ашан", Водитель: "", "Плановая дата": "ошибка" },
  ];
  Object.defineProperty(rows[2], "__rowNum__", { value: 7 });
  assert.deepEqual(buildScheduleReviewRows(rows), [
    { row: 2, siteName: "Лента 12", driverName: "Петров", plannedDate: "2026-09-05" },
    { row: 8, siteName: "Ашан", driverName: "", plannedDate: "ошибка" },
  ]);
});
