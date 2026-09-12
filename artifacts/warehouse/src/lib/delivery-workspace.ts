import { excelSerialToIsoDate, str } from "./excel-import.ts";
import {
  resolveImportDriver,
  type ImportDriver,
} from "./driver-import.ts";

export type DeliveryCellTone = "none" | "orange" | "green";
export type DriverDeliveryCategory = "not_completed" | "done" | "closed";

export type DeliveryImportMode = "replace" | "add";

export type DeliveryImportItem = {
  siteId: string;
  driverUserId: string | null;
  plannedDate: string | null;
  scheduleMonth: string;
};

export type SkippedImportRow = {
  rowNumber: number;
  siteName: string;
  reasonCode: "missing_site" | "invalid_date" | "other_month" | "duplicate";
  reason: string;
};

export type DeliveryImportReview = {
  items: DeliveryImportItem[];
  skippedRows: SkippedImportRow[];
};

export const SKIPPED_IMPORT_EXPORT_HEADERS = ["Строка", "Объект", "Причина"];

export function buildSkippedImportExportRows(
  skippedRows: readonly SkippedImportRow[],
): Record<string, string | number>[] {
  return skippedRows.map((row) => ({
    Строка: row.rowNumber,
    Объект: row.siteName,
    Причина: row.reason,
  }));
}

export function dispatchDeliveryImportByMode(
  items: DeliveryImportItem[],
  mode: DeliveryImportMode,
  actions: Record<DeliveryImportMode, (items: DeliveryImportItem[]) => void>,
): void {
  actions[mode](items);
}

type DeliveryImportSite = {
  id: string;
  name: string;
  driverUserId: string | null;
};

export function formatMonthLabel(value: string): string {
  const [year, monthNumber] = value.split("-").map(Number);
  if (!year || !monthNumber) return value;
  const monthName = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
  return `${monthName} ${String(year).slice(-2)}`;
}

export function buildDeliveryImportReview(
  rows: ReadonlyArray<Record<string, unknown>>,
  expectedMonth: string,
  sites: readonly DeliveryImportSite[],
  drivers: ImportDriver[],
): DeliveryImportReview {
  const siteByName = new Map(
    sites.map((site) => [site.name.trim().toLowerCase(), site]),
  );
  const items: DeliveryImportItem[] = [];
  const skippedRows: SkippedImportRow[] = [];
  const firstRowByDeliveryKey = new Map<string, number>();

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const siteName = str(row["Объект"]);
    const site = siteByName.get(siteName.toLowerCase());
    if (!site) {
      skippedRows.push({
        rowNumber,
        siteName,
        reasonCode: "missing_site",
        reason: siteName
          ? "Объект не найден в справочнике"
          : "Название объекта не указано",
      });
      continue;
    }

    const dateResult = parseImportPlannedDate(
      row["Плановая дата"],
      expectedMonth,
    );
    if (!dateResult.valid) {
      const normalizedDate = excelSerialToIsoDate(row["Плановая дата"]);
      const belongsToAnotherMonth =
        /^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) &&
        normalizedDate.slice(0, 7) !== expectedMonth;
      skippedRows.push({
        rowNumber,
        siteName,
        reasonCode: belongsToAnotherMonth ? "other_month" : "invalid_date",
        reason: belongsToAnotherMonth
          ? `Дата ${normalizedDate} относится к другому месяцу; выбран ${formatMonthLabel(expectedMonth)}`
          : "Некорректная плановая дата",
      });
      continue;
    }

    const plannedDate = dateResult.date;
    const deliveryKey = `${site.id}:${plannedDate ?? "undated"}`;
    const firstRowNumber = firstRowByDeliveryKey.get(deliveryKey);
    if (firstRowNumber !== undefined) {
      skippedRows.push({
        rowNumber,
        siteName,
        reasonCode: "duplicate",
        reason: `Повтор объекта на ${plannedDate ?? "дату без назначения"}; загружена строка ${firstRowNumber}`,
      });
      continue;
    }
    firstRowByDeliveryKey.set(deliveryKey, rowNumber);

    const matchedDriver = resolveImportDriver(
      drivers,
      str(row["Водитель"]),
      str(row["Email водителя"]),
    );
    const driverUserId = matchedDriver?.id ?? site.driverUserId;
    if (!driverUserId) {
      throw new Error(
        `Для объекта «${site.name}» не указан водитель из справочника пользователей-водителей`,
      );
    }
    items.push({
      siteId: site.id,
      driverUserId,
      plannedDate,
      scheduleMonth: expectedMonth,
    });
  }

  return { items, skippedRows };
}

export function getDriverDeliveryCategory(
  workflowStatus: "planned" | "done" | "closed",
): DriverDeliveryCategory {
  if (workflowStatus === "closed") return "closed";
  if (workflowStatus === "done") return "done";
  return "not_completed";
}

export function toDateInputValue(date: string | null): string {
  if (!date) return "";
  return date.slice(0, 10);
}

export function getDeliveryCellTone(
  actualDate: string | null,
  photosCount: number,
  workflowStatus?: "planned" | "done" | "closed"
): DeliveryCellTone {
  if (workflowStatus === "closed") return "green";
  if (workflowStatus === "done") return "orange";
  if (!actualDate) return "none";
  return photosCount > 0 ? "green" : "orange";
}

export function getMonthDateBounds(month: string): {
  min: string;
  max: string;
} {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return {
    min: `${month}-01`,
    max: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function confirmPlannedDate(plannedDate: string): string {
  return toDateInputValue(plannedDate);
}

export function parseImportPlannedDate(
  rawDate: unknown,
  expectedMonth: string,
): { valid: false } | { valid: true; date: string | null } {
  if (rawDate === undefined || rawDate === null || rawDate === "") {
    return { valid: true, date: null };
  }

  const plannedDate = excelSerialToIsoDate(rawDate);
  const parsedDate = new Date(`${plannedDate}T00:00:00.000Z`);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(plannedDate) ||
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== plannedDate ||
    plannedDate.slice(0, 7) !== expectedMonth
  ) {
    return { valid: false };
  }

  return { valid: true, date: plannedDate };
}

export function canRescheduleDelivery(actualDate: string | null): boolean {
  return actualDate === null;
}

export function getInitialRescheduleDate(plannedDate: string): string {
  return toDateInputValue(plannedDate);
}

type ScheduleDeliveryState = {
  plannedDate: string | null;
  actualDate: string | null;
  photosCount: number;
  workflowStatus?: "planned" | "done" | "closed";
};

export function getScheduleCellState(
  deliveries: readonly ScheduleDeliveryState[],
  day: string,
): {
  hasPlan: boolean;
  hasDoneNoAct: boolean;
  hasDoneWithAct: boolean;
  hasClosed: boolean;
  tone: DeliveryCellTone;
} {
  let hasPlan = false;
  let hasDoneNoAct = false;
  let hasDoneWithAct = false;
  let hasClosed = false;

  for (const delivery of deliveries) {
    if (toDateInputValue(delivery.plannedDate) === day) hasPlan = true;
    if (
      !delivery.actualDate ||
      toDateInputValue(delivery.actualDate) !== day
    ) {
      continue;
    }

    const tone = getDeliveryCellTone(
      delivery.actualDate,
      delivery.photosCount,
      delivery.workflowStatus,
    );
    if (tone === "orange") hasDoneNoAct = true;
    if (tone === "green" && delivery.workflowStatus === "closed") {
      hasClosed = true;
    } else if (tone === "green") {
      hasDoneWithAct = true;
    }
  }

  return {
    hasPlan,
    hasDoneNoAct,
    hasDoneWithAct,
    hasClosed,
    tone: hasClosed || hasDoneWithAct ? "green" : hasDoneNoAct ? "orange" : "none",
  };
}

export type DeliveryActUploadResult<TFile> =
  | { file: TFile; status: "added" }
  | { file: TFile; status: "failed"; error: unknown };

export type DeliveryActUploadSession<TFile> = {
  deliveryId: string;
  results: DeliveryActUploadResult<TFile>[];
};

export function getRetryableDeliveryActFiles<TFile>(
  session: DeliveryActUploadSession<TFile> | null,
  activeDeliveryId: string | undefined,
): TFile[] {
  if (!session || session.deliveryId !== activeDeliveryId) return [];
  return session.results
    .filter((result) => result.status === "failed")
    .map((result) => result.file);
}

export async function uploadDeliveryActsSequentially<TFile, TUpload>(
  files: readonly TFile[],
  upload: (file: TFile) => Promise<TUpload | null | undefined>,
  attach: (file: TFile, uploaded: TUpload) => Promise<void>,
): Promise<DeliveryActUploadResult<TFile>[]> {
  const results: DeliveryActUploadResult<TFile>[] = [];

  for (const file of files) {
    try {
      const uploaded = await upload(file);
      if (uploaded == null) {
        throw new Error("Файл не был загружен");
      }
      await attach(file, uploaded);
      results.push({ file, status: "added" });
    } catch (error) {
      results.push({ file, status: "failed", error });
    }
  }

  return results;
}

export function removeDeliveryActById<T extends { id: string }>(
  photos: readonly T[] | undefined,
  deletedId: string,
): T[] | undefined {
  return photos?.filter((photo) => photo.id !== deletedId);
}