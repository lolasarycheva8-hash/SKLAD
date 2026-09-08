import { excelSerialToIsoDate } from "./excel-import.ts";

export type DeliveryCellTone = "none" | "orange" | "green";
export type DriverDeliveryCategory = "not_completed" | "done" | "closed";

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