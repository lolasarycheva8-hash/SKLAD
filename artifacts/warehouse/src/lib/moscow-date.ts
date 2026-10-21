function datePart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function formatMoscowDate(
  date: Date = new Date(),
  formatter: Intl.DateTimeFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }),
): string {
  const parts = formatter.formatToParts(date);
  return `${datePart(parts, "year")}-${datePart(parts, "month")}-${datePart(parts, "day")}`;
}

export function currentMoscowMonth(
  date: Date = new Date(),
  formatter: Intl.DateTimeFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
  }),
): string {
  const parts = formatter.formatToParts(date);
  return `${datePart(parts, "year")}-${datePart(parts, "month")}`;
}

export function isCanonicalMonth(value: string): boolean {
  return value.length === 7 && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value);
}

/** Calendar arithmetic only: no timezone conversion or business-date changes. */
export function adjacentCalendarMonth(
  value: string,
  direction: -1 | 1,
): string | null {
  if (!isCanonicalMonth(value)) return null;
  const [year, month] = value.split("-").map(Number);
  const index = year * 12 + month - 1 + direction;
  const nextYear = Math.floor(index / 12);
  if (nextYear < 1000 || nextYear > 9999) return null;
  return `${nextYear}-${String((index % 12) + 1).padStart(2, "0")}`;
}