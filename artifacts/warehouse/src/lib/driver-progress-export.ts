import * as XLSX from "xlsx";
import { getDeliveryProgress } from "./delivery-progress.ts";
import { formatDriverProgressWorkbook } from "./driver-progress-format.ts";

type Delivery = Parameters<typeof getDeliveryProgress>[0][number] & {
  driverUserId: string | null;
  driver: string;
};
type Driver = { id: string; name?: string | null; email: string };

export function buildDriverProgressWorkbook(
  deliveries: readonly Delivery[],
  drivers: readonly Driver[],
  month: string,
  today: string,
) {
  const total = getDeliveryProgress(deliveries, month, today);
  const groups = new Map<string, { name: string; deliveries: Delivery[] }>();
  for (const driver of drivers) {
    groups.set(driver.id, { name: driver.name || driver.email, deliveries: [] });
  }
  for (const delivery of deliveries) {
    if (delivery.archivedAt || delivery.plannedDate?.slice(0, 7) !== month) continue;
    const key = delivery.driverUserId ?? "unassigned";
    if (!groups.has(key)) {
      groups.set(key, { name: delivery.driverUserId ? delivery.driver || "Водитель" : "Не назначен", deliveries: [] });
    }
    groups.get(key)!.deliveries.push(delivery);
  }
  const percent = (value: number, plan: number) => plan > 0 ? value / plan : "—";
  const cells = (summary: typeof total) => [
    summary.periodPlan, percent(summary.periodPlan, summary.periodPlan),
    summary.periodFact, percent(summary.periodFact, summary.periodPlan),
    summary.periodClosed, percent(summary.periodClosed, summary.periodPlan),
    summary.monthPlan, percent(summary.monthPlan, summary.monthPlan),
    summary.done, percent(summary.done, summary.monthPlan),
    summary.closed, percent(summary.closed, summary.monthPlan),
  ];
  const date = (value: string) => value.split("-").reverse().join(".");
  const range = total.started ? `${date(total.start)} — ${date(total.through)}` : total.periodEmptyLabel;
  const data: (string | number)[][] = [
    [`Сводный отчёт по водителям · ${month}`],
    [`По состоянию на ${date(today)} (Москва). Период: ${range}`],
    ["Водитель", "За период — % от плана периода", "", "", "", "", "", "Итоги месяца — % от плана месяца", "", "", "", "", ""],
    ["Водитель", "План, шт.", "План, %", "Выполнено, шт.", "Выполнено, %", "Закрыто, шт.", "Закрыто, %",
      "План, шт.", "План, %", "Выполнено, шт.", "Выполнено, %", "Закрыто, шт.", "Закрыто, %"],
    ...[...groups.entries()]
      .filter(([, group]) => group.deliveries.length > 0)
      .sort(([a, x], [b, y]) => a === "unassigned" ? 1 : b === "unassigned" ? -1 : x.name.localeCompare(y.name, "ru") || a.localeCompare(b))
      .map(([, group]) => [group.name, ...cells(getDeliveryProgress(group.deliveries, month, today))]),
    ["ИТОГО", ...cells(total)],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 12 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 12 } },
    { s: { r: 2, c: 1 }, e: { r: 2, c: 6 } },
    { s: { r: 2, c: 7 }, e: { r: 2, c: 12 } },
  ];
  sheet["!cols"] = [{ width: 34.5 }, ...Array.from({ length: 12 }, () => ({ width: 12.5 }))];
  sheet["!rows"] = data.map((_, index) => ({ hpt: index === 3 ? 34 : index === 2 ? 17 : 15.75 }));
  sheet["!autofilter"] = { ref: `A4:M${Math.max(4, data.length - 1)}` };
  for (let row = 4; row < data.length; row++) {
    for (let col = 2; col <= 12; col += 2) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell?.t === "n") cell.z = "0.0%";
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Сводка по водителям");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Как читать отчёт"],
    ["Выгружаются только водители с доставками в графике выбранного месяца, независимо от поиска и фильтров таблицы."],
    ["План месяца — доставки с исходной плановой датой в выбранном месяце. Удалённые и без даты не учитываются."],
    ["Выполнено — по фактической дате с начала выбранного месяца по сегодня, включая досрочные доставки."],
    ["Закрыто — из выполненных доставок с подтверждёнными актами: в итогах месяца к сегодня, за период — до конца периода. Входит в «Выполнено»."],
    ["Период — с 1-го числа по вчера включительно. План — по исходной плановой дате, выполнено — по фактической."],
    ["Проценты водителя — от его плана; проценты строки ИТОГО — от общего плана, не среднее процентов."],
    ["Для прошедшего месяца период охватывает весь месяц. Для будущего — ещё не начался."],
    ["При нулевом плане вместо процента — прочерк. Процент может превышать 100% при досрочном выполнении."],
  ]), "Пояснения");
  return workbook;
}

export function exportDriverProgress(
  deliveries: readonly Delivery[], drivers: readonly Driver[], month: string, today: string,
) {
  const bytes = formatDriverProgressWorkbook(buildDriverProgressWorkbook(deliveries, drivers, month, today));
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `svodka-voditeli-${month}-na-${today}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}