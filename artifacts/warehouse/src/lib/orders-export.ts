import type { Order } from "@workspace/api-client-react";
import * as XLSX from "xlsx";

const STATUS_LABELS: Record<Order["status"], string> = {
  draft: "Черновик",
  shipped: "Отгружен",
  delivered: "Доставлен",
  awaiting_payment: "Ожидает оплаты",
  paid: "Оплачен",
};
const orderStatusLabel = (status: Order["status"]) => STATUS_LABELS[status] ?? status;

const MOSCOW_DATE = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const MONEY_FORMAT = '#,##0.00 "₽"';
const QUANTITY_FORMAT = "#,##0.###";

function orderDate(value: string): string {
  return MOSCOW_DATE.format(new Date(value));
}

function makeSheet(rows: (string | number)[][], moneyColumns: number[], quantityColumns: number[] = []) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  for (const [rowIndex, row] of rows.entries()) {
    for (const [columnIndex, value] of row.entries()) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
      if (typeof value === "string") {
        // Even text beginning with =, +, -, or @ must remain a literal cell.
        cell.t = "s";
        delete cell.f;
      } else if (rowIndex > 0) {
        cell.z = moneyColumns.includes(columnIndex) ? MONEY_FORMAT
          : quantityColumns.includes(columnIndex) ? QUANTITY_FORMAT : "0";
      }
    }
  }
  sheet["!cols"] = rows[0].map((_, index) => ({
    wch: index === 0 ? 22 : 24,
  }));
  return sheet;
}

export function buildOrdersWorkbook(orders: Order[]): Uint8Array {
  const summary: (string | number)[][] = [[
    "ID заказа", "Дата заказа (МСК)", "Клиент", "Магазин", "Адрес",
    "Позиций", "Сумма заказа", "Оплачено", "Переплата", "Статус", "Примечание",
    "Товары и количество",
    "Месяц плана", "Источник месяца",
  ]];
  const items: (string | number)[][] = [[
    "ID заказа", "Дата заказа (МСК)", "Клиент", "Магазин", "Адрес",
    "Товар", "Количество", "Цена за единицу", "Сумма позиции",
    "Месяц плана", "Источник месяца",
  ]];

  for (const order of orders) {
    const date = orderDate(order.createdAt);
    summary.push([
      order.id, date, order.clientName, order.siteName ?? "", order.siteAddress ?? "",
      order.items.length, order.totalAmount, order.paidAmount, order.overpaidAmount,
      orderStatusLabel(order.status), order.note ?? "",
      order.items.map((item) => `${item.productName} — ${item.quantity}`).join("; "),
      order.plannedMonth ?? "", order.monthFromDelivery ? "Доставка" : "Заказ",
    ]);
    for (const item of order.items) {
      items.push([
        order.id, date, order.clientName, order.siteName ?? "", order.siteAddress ?? "",
        item.productName, item.quantity, item.price, item.quantity * item.price,
        order.plannedMonth ?? "", order.monthFromDelivery ? "Доставка" : "Заказ",
      ]);
    }
  }

  const workbook = XLSX.utils.book_new();
  const detailSheet = makeSheet(items, [7, 8], [6]);
  detailSheet["!cols"]![5] = { wch: 65 };
  const summarySheet = makeSheet(summary, [6, 7, 8], [5]);
  summarySheet["!cols"]![11] = { wch: 90 };
  XLSX.utils.book_append_sheet(workbook, detailSheet, "Состав заказов");
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Заказы");
  return new Uint8Array(XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer);
}

export function downloadOrdersWorkbook(orders: Order[]): void {
  const bytes = buildOrdersWorkbook(orders);
  const buffer = new Uint8Array(bytes.byteLength);
  buffer.set(bytes);
  const url = URL.createObjectURL(new Blob([buffer.buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `заказы-всех-клиентов-${new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" })}.xlsx`;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Let the browser start consuming the file before releasing its URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}