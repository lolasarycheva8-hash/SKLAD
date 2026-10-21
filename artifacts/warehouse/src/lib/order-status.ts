import type { OperationalOrderStatus, OrderSummaryBlocker } from "@workspace/api-client-react";

export const ORDER_STATUS_LABELS: Record<OperationalOrderStatus, string> = {
  draft: "Черновик",
  shipped: "Отгружен",
  delivered: "Доставлен",
  awaiting_payment: "Ожидает оплаты",
  paid: "Оплачен",
};

export const ORDER_STATUS_CLASSES: Record<OperationalOrderStatus, string> = {
  draft: "bg-slate-100 text-slate-700 hover:bg-slate-100",
  shipped: "bg-sky-100 text-sky-800 hover:bg-sky-100",
  delivered: "bg-teal-100 text-teal-800 hover:bg-teal-100",
  awaiting_payment: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
  paid: "bg-green-100 text-green-800 hover:bg-green-100",
};

export function orderStatusLabel(status: string | null | undefined): string {
  return (status && ORDER_STATUS_LABELS[status as OperationalOrderStatus]) || "—";
}

export type OrderTab = "work" | "awaiting" | "paid";
export const ORDER_TAB_STATUSES: Record<OrderTab, OperationalOrderStatus[]> = {
  work: ["draft", "shipped", "delivered"],
  awaiting: ["awaiting_payment"],
  paid: ["paid"],
};

export function orderMatchesTab(status: OperationalOrderStatus, tab: OrderTab): boolean {
  return ORDER_TAB_STATUSES[tab].includes(status);
}

/** Billed orders (summary member, awaiting or paid) are locked for shipments and edits. */
export function isOrderBilled(order: { status: OperationalOrderStatus; summaryId: string | null }): boolean {
  return !!order.summaryId || order.status === "awaiting_payment" || order.status === "paid";
}

export const SUMMARY_STATUS_LABELS = {
  awaiting_payment: "Ожидает оплаты",
  paid: "Оплачен",
} as const;

export function apiErrorMessage(error: unknown): string {
  const e = error as { data?: { error?: unknown } | null; message?: string } | null;
  if (e?.data && typeof e.data.error === "string" && e.data.error) return e.data.error;
  return e?.message || "Неизвестная ошибка";
}

export function apiErrorBlockers(error: unknown): OrderSummaryBlocker[] {
  const e = error as { data?: { blockers?: unknown } | null } | null;
  return Array.isArray(e?.data?.blockers) ? (e!.data!.blockers as OrderSummaryBlocker[]) : [];
}

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
export function formatMonth(value: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(value);
  if (!m) return value;
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
export function formatPeriod(from: string, to: string): string {
  const a = from.slice(0, 7);
  const b = to.slice(0, 7);
  return a === b ? formatMonth(a) : `${formatMonth(a)} — ${formatMonth(b)}`;
}

export const SELLER_NAME = "ООО ТД Альянс";
