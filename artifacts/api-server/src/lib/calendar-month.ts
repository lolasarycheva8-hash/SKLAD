export const INVALID_MONTH_MESSAGE =
  "Месяц должен быть корректным значением в формате YYYY-MM";

// Matches CalendarMonth in OpenAPI. Validate raw input before query coercion:
// a repeated query parameter is an array, not a calendar month.
export function isValidMonth(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === 7 &&
    /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)
  );
}

export function monthRange(month: string): { start: string; end: string } {
  if (!isValidMonth(month)) throw new RangeError(INVALID_MONTH_MESSAGE);
  const [year, mon] = month.split("-").map(Number);
  // Build the exclusive bound without Date normalization or ISO slicing.
  // December 9999 ends at PostgreSQL's valid 10000-01-01, not "+010000-01".
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMonth = mon === 12 ? 1 : mon + 1;
  return {
    start: `${month}-01`,
    end: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

export function moscowDateISO(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function currentMonth(date: Date = new Date()): string {
  return moscowDateISO(date).slice(0, 7);
}