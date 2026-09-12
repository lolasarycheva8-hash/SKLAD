import { ZipArchive } from "archiver";
import { once } from "node:events";
import { finished } from "node:stream";
import type { Readable, Writable } from "node:stream";

export const MAX_DELIVERY_ACT_FILES = 2_000;

export type DeliveryActArchiveItem = {
  objectPath: string;
  fileName: string;
  actualDate: string | null;
  siteName: string;
};

export type DeliveryActDateRange =
  | { success: true; from: string; to: string }
  | { success: false; error: string };

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function utcDay(date: string): number {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
}

export function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  return new Date(utcDay(value)).toISOString().slice(0, 10) === value;
}

export function validateDeliveryActDateRange(
  from: unknown,
  to: unknown,
): DeliveryActDateRange {
  if (typeof from !== "string" || typeof to !== "string" ||
      !isRealIsoDate(from) || !isRealIsoDate(to)) {
    return {
      success: false,
      error: "Укажите корректные даты from и to в формате YYYY-MM-DD",
    };
  }
  const fromDay = utcDay(from);
  const toDay = utcDay(to);
  if (fromDay > toDay) {
    return { success: false, error: "Дата from не может быть позже даты to" };
  }
  if ((toDay - fromDay) / 86_400_000 + 1 > 366) {
    return { success: false, error: "Период не может превышать 366 дней" };
  }
  return { success: true, from, to };
}

export function sanitizeArchiveName(value: string, fallback: string): string {
  const sanitized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 120);
  return sanitized || fallback;
}

export function deliveryActArchiveEntryName(
  item: DeliveryActArchiveItem,
  occurrence = 1,
): string {
  const site = sanitizeArchiveName(item.siteName, "объект");
  const file = sanitizeArchiveName(item.fileName, "акт");
  const extensionMatch = file.match(/(\.[A-Za-z0-9]{1,10})$/);
  const extension = extensionMatch?.[1] ?? "";
  const date = item.actualDate
    ? `${item.actualDate.slice(8, 10)}.${item.actualDate.slice(5, 7)}.${item.actualDate.slice(0, 4)}`
    : "без-даты-факт";
  const suffix = occurrence > 1 ? `-${occurrence}` : "";
  return `${site}-${date}${suffix}${extension}`;
}

export async function streamDeliveryActsZip(
  items: DeliveryActArchiveItem[],
  output: Writable,
  openStream: (item: DeliveryActArchiveItem, signal: AbortSignal) => Promise<Readable>,
  externalSignal?: AbortSignal,
): Promise<void> {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const controller = new AbortController();
  const signal = controller.signal;
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  if (externalSignal?.aborted) onExternalAbort();
  const archiveFailed = new Promise<never>((_resolve, reject) => {
    archive.once("error", reject);
  });
  void archiveFailed.catch(() => undefined);
  let currentSource: Readable | undefined;
  let rejectOutputFailure!: (error: unknown) => void;
  const outputFailure = new Promise<never>((_resolve, reject) => {
    rejectOutputFailure = reject;
  });
  void outputFailure.catch(() => undefined);
  let outputFailed = false;
  let outputFailureError: unknown;
  const failOutput = (error: unknown) => {
    if (outputFailed) return;
    outputFailed = true;
    outputFailureError = error;
    rejectOutputFailure(error);
    controller.abort(error);
    currentSource?.destroy();
    archive.abort();
  };
  const onInternalAbort = () => {
    rejectAbort(new DOMException("Download aborted", "AbortError"));
  };
  let rejectAbort!: (error: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
    signal.addEventListener("abort", onInternalAbort, { once: true });
  });
  void aborted.catch(() => undefined);
  let cleanupOutput: (() => void) | undefined;
  const outputFinished = new Promise<boolean>((resolve) => {
    cleanupOutput = finished(output, (error) => {
      if (error) failOutput(error);
      resolve(!error);
    });
  });
  const abort = () => {
    currentSource?.destroy();
    archive.abort();
  };
  signal.addEventListener("abort", abort, { once: true });
  archive.pipe(output);
  const entryNameOccurrences = new Map<string, number>();

  try {
    for (let index = 0; index < items.length; index += 1) {
      if (signal.aborted) {
        throw outputFailureError ?? new DOMException("Download aborted", "AbortError");
      }
      const pendingOpen = openStream(items[index], signal).then((stream) => {
        if (signal.aborted) {
          stream.destroy();
          throw outputFailureError ?? new DOMException("Download aborted", "AbortError");
        }
        return stream;
      });
      void pendingOpen.catch(() => undefined);
      currentSource = await Promise.race([pendingOpen, aborted, outputFailure]);
      if (signal.aborted) {
        currentSource.destroy();
        throw outputFailureError ?? new DOMException("Download aborted", "AbortError");
      }
      const sourceFinished = once(currentSource, "end");
      const firstEntryName = deliveryActArchiveEntryName(items[index]);
      const entryKey = firstEntryName.toLocaleLowerCase("ru-RU");
      const occurrence = (entryNameOccurrences.get(entryKey) ?? 0) + 1;
      entryNameOccurrences.set(entryKey, occurrence);
      archive.append(currentSource, {
        name: deliveryActArchiveEntryName(items[index], occurrence),
      });
      await Promise.race([sourceFinished, archiveFailed, aborted, outputFailure]);
      currentSource = undefined;
    }
    await Promise.race([archive.finalize(), archiveFailed, aborted, outputFailure]);
    const outputSucceeded = await Promise.race([
      outputFinished,
      archiveFailed,
      aborted,
      outputFailure,
    ]);
    if (!outputSucceeded) throw new Error("Archive output closed prematurely");
  } catch (error) {
    controller.abort(error);
    currentSource?.destroy();
    archive.abort();
    throw error;
  } finally {
    cleanupOutput?.();
    signal.removeEventListener("abort", abort);
    signal.removeEventListener("abort", onInternalAbort);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

export async function preflightDeliveryActObjects(
  items: DeliveryActArchiveItem[],
  verify: (item: DeliveryActArchiveItem, signal: AbortSignal) => Promise<void>,
  externalSignal: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const signal = controller.signal;
  const onExternalAbort = () => controller.abort(externalSignal.reason);
  externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  if (externalSignal.aborted) onExternalAbort();
  let next = 0;
  let firstFailure: unknown;
  const worker = async () => {
    while (true) {
      if (signal.aborted) throw new DOMException("Download aborted", "AbortError");
      const index = next++;
      if (index >= items.length) return;
      try {
        await verify(items[index], signal);
      } catch (error) {
        if (firstFailure === undefined) firstFailure = error;
        controller.abort(error);
        throw error;
      }
    }
  };
  try {
    const outcomes = await Promise.allSettled(
      Array.from({ length: Math.min(8, items.length) }, () => worker()),
    );
    if (firstFailure !== undefined) throw firstFailure;
    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected",
    );
    if (rejected) throw rejected.reason;
  } finally {
    externalSignal.removeEventListener("abort", onExternalAbort);
  }
}