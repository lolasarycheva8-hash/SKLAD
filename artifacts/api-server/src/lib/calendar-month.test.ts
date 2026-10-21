import assert from "node:assert/strict";
import { test } from "node:test";
import {
  currentMonth,
  INVALID_MONTH_MESSAGE,
  isValidMonth,
  monthRange,
  moscowDateISO,
} from "./calendar-month.ts";

test("calendar month rejects malformed values without date normalization", () => {
  for (const value of [
    "09/2026", "2026-13", "2026-00", "2026-1", "2026-001",
    "0000-01", "0099-01", "10000-01", "2026-09-01",
    "", " 2026-09", "2026-09 ", "2026-09\n", "abcd-ef",
    null, undefined, 202609, ["2026-09"], {},
  ]) {
    assert.equal(isValidMonth(value), false, JSON.stringify(value));
    if (typeof value === "string") {
      assert.throws(() => monthRange(value), { message: INVALID_MONTH_MESSAGE });
    }
  }
});

test("calendar month keeps exclusive bounds including leap February and December", () => {
  for (const [month, end] of [
    ["1000-01", "1000-02-01"],
    ["2026-09", "2026-10-01"],
    ["2024-02", "2024-03-01"],
    ["2026-02", "2026-03-01"],
    ["2026-12", "2027-01-01"],
    ["9999-12", "10000-01-01"],
  ]) {
    assert.equal(isValidMonth(month), true);
    assert.deepEqual(monthRange(month), { start: `${month}-01`, end });
  }
});

test("current month and date change at Moscow midnight, not UTC midnight", () => {
  for (const [instant, expected] of [
    ["2026-08-31T20:59:59.999Z", "2026-08-31"],
    ["2026-08-31T21:00:00.000Z", "2026-09-01"],
    ["2026-12-31T21:00:00.000Z", "2027-01-01"],
    ["2024-02-29T21:00:00.000Z", "2024-03-01"],
  ]) {
    const date = new Date(instant);
    assert.equal(moscowDateISO(date), expected);
    assert.equal(currentMonth(date), expected.slice(0, 7));
  }
});

test("Moscow dates do not use locale-dependent formatted strings", (t) => {
  t.mock.getter(Intl.DateTimeFormat.prototype, "format", () => () => "09/2026");
  assert.equal(currentMonth(new Date("2026-09-18T12:00:00Z")), "2026-09");
});