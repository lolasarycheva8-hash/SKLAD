import assert from "node:assert/strict";
import test from "node:test";
import {
  currentMoscowMonth,
  adjacentCalendarMonth,
  formatMoscowDate,
  isCanonicalMonth,
} from "./moscow-date.ts";

test("builds a canonical month from localized format parts, not format()", () => {
  const formatter = {
    format: () => "09/2026",
    formatToParts: () => [
      { type: "month", value: "09" },
      { type: "literal", value: "/" },
      { type: "year", value: "2026" },
    ],
  } as unknown as Intl.DateTimeFormat;

  assert.equal(currentMoscowMonth(new Date("2026-09-01T00:00:00Z"), formatter), "2026-09");
});

test("Moscow formatter handles a UTC date across the local day boundary", () => {
  const instant = new Date("2025-12-31T21:30:00.000Z");
  assert.equal(currentMoscowMonth(instant), "2026-01");
  assert.equal(formatMoscowDate(instant), "2026-01-01");
});

test("accepts only complete canonical month input", () => {
  assert.equal(isCanonicalMonth("2026-09"), true);
  assert.equal(isCanonicalMonth("09/2026"), false);
  assert.equal(isCanonicalMonth("2026-"), false);
  assert.equal(isCanonicalMonth("2026-13"), false);
  assert.equal(isCanonicalMonth("0000-09"), false);
  assert.equal(isCanonicalMonth("0999-09"), false);
  assert.equal(isCanonicalMonth("10000-09"), false);
  assert.equal(isCanonicalMonth("2026-09\n"), false);
  assert.equal(isCanonicalMonth(" 2026-09"), false);
  assert.equal(isCanonicalMonth("1000-01"), true);
  assert.equal(isCanonicalMonth("9999-12"), true);
});

test("previous and next months are canonical, including crossing a year", () => {
  assert.equal(adjacentCalendarMonth("2026-10", -1), "2026-09");
  assert.equal(adjacentCalendarMonth("2026-09", 1), "2026-10");
  assert.equal(adjacentCalendarMonth("2026-01", -1), "2025-12");
  assert.equal(adjacentCalendarMonth("2026-12", 1), "2027-01");
  assert.equal(adjacentCalendarMonth("2024-03", -1), "2024-02");
});

test("month navigation rejects malformed input and stays within the API contract", () => {
  assert.equal(adjacentCalendarMonth("09/2026", -1), null);
  assert.equal(adjacentCalendarMonth("1000-01", -1), null);
  assert.equal(adjacentCalendarMonth("9999-12", 1), null);
  assert.equal(adjacentCalendarMonth("1000-01", 1), "1000-02");
  assert.equal(adjacentCalendarMonth("9999-12", -1), "9999-11");
});