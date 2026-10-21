import type { OrderSummary } from "@workspace/api-client-react";
import * as XLSX from "xlsx";
import { SELLER_NAME, SUMMARY_STATUS_LABELS, formatPeriod } from "./order-status";

export function buildOrderSummaryWorkbook(summary: OrderSummary): Uint8Array {
  const rows: (string | number)[][] = [
    [`Итоговый заказ № ${summary.number}`],
    ["Поставщик", SELLER_NAME],
    ["Клиент", summary.clientName],
    ["Период", formatPeriod(summary.periodFrom, summary.periodTo)],
    ["Статус оплаты", SUMMARY_STATUS_LABELS[summary.status]],
    ["Заказы", summary.orders.map((o) => o.number).join(", ")],
    [],
    ["№", "Товар", "Ед.", "Количество", "Цена", "Сумма"],
    ...summary.items.map((item, i) => [i + 1, item.productName, item.unit, item.quantity, item.price, item.total]),
    ["", "", "", "", "Итого", summary.totalAmount],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  for (const [r, row] of rows.entries()) {
    for (const [c, value] of row.entries()) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      if (typeof value === "string") { cell.t = "s"; delete cell.f; }
      else if (c >= 4) cell.z = '#,##0.00 "₽"';
    }
  }
  sheet["!cols"] = [{ wch: 16 }, { wch: 60 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Итоговый заказ");
  return new Uint8Array(XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer);
}

export function downloadOrderSummaryWorkbook(summary: OrderSummary) {
  const blob = new Blob([buildOrderSummaryWorkbook(summary) as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Итоговый заказ ${summary.number} ${summary.clientName}.xlsx`.replace(/[\\/:*?"<>|]/g, "_");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
