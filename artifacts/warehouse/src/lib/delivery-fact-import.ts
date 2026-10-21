import type { Delivery } from "@workspace/api-client-react";
import { excelSerialToIsoDate, str } from "./excel-import.ts";

export const DELIVERY_FACT_HEADERS = [
  "Объект",
  "Водитель",
  "Плановая дата",
  "Дата факта",
];

export function formatDeliveryFactDate(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10).split("-").reverse().join(".");
}

export function parseDeliveryFactDate(value: unknown): string {
  if (typeof value === "number") return excelSerialToIsoDate(value);
  const normalized = str(value);
  if (!normalized) return "";

  const ruMatch = normalized.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ruMatch) {
    return `${ruMatch[3]}-${ruMatch[2]!.padStart(2, "0")}-${ruMatch[1]!.padStart(2, "0")}`;
  }

  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  return excelSerialToIsoDate(normalized);
}

export function deliveryFactExportRows(deliveries: Delivery[]) {
  return deliveries
    .filter((delivery) => delivery.plannedDate)
    .sort((left, right) => {
      const byDate = left.plannedDate!.localeCompare(right.plannedDate!);
      return byDate || left.siteName.localeCompare(right.siteName, "ru");
    })
    .map((delivery) => ({
      Объект: delivery.siteName,
      Водитель: delivery.driver,
      "Плановая дата": formatDeliveryFactDate(delivery.plannedDate),
      "Дата факта": formatDeliveryFactDate(delivery.actualDate),
    }));
}

export function buildDeliveryFactUpdates(
  fileRows: Record<string, unknown>[],
  deliveries: Delivery[],
  fallbackPlannedDate = "",
) {
  const byKey = new Map(
    deliveries
      .filter((delivery) => delivery.plannedDate)
      .map((delivery) => [
        `${delivery.siteName.trim().toLocaleLowerCase("ru")}|${delivery.plannedDate!.slice(0, 10)}`,
        delivery,
      ]),
  );
  const updates: { id: string; actualDate: string }[] = [];
  const unmatched: string[] = [];

  for (const row of fileRows) {
    const siteName = str(row["Объект"]);
    if (!siteName) continue;
    const actualDate = parseDeliveryFactDate(row["Дата факта"]);
    if (!actualDate) continue;
    const plannedDate =
      parseDeliveryFactDate(row["Плановая дата"]) || fallbackPlannedDate;
    const delivery = byKey.get(
      `${siteName.trim().toLocaleLowerCase("ru")}|${plannedDate}`,
    );
    if (!delivery) {
      unmatched.push(siteName);
      continue;
    }
    if (delivery.actualDate?.slice(0, 10) !== actualDate) {
      updates.push({ id: delivery.id, actualDate });
    }
  }

  return { updates, unmatched };
}