import { createHash } from "node:crypto";
import type { ScheduleFileRow, ScheduleReviewRow } from "@workspace/api-zod";
import { isRealIsoDate } from "./delivery-act-download";

type Site = { id: string; name: string; deliveryType: string };
type Driver = { id: string; name: string };
type Delivery = {
  id: string; siteId: string; plannedDate: string | null; driverUserId: string | null;
  actualDate: string | null; actApprovedAt: unknown; orderId: string | null;
  correctedPlannedDate: string | null; deletionPendingAt: unknown;
};
export type ScheduleState = {
  sites: Site[]; drivers: Driver[]; deliveries: Delivery[]; frozenIds: string[];
};
const normalize = (s: string) => s.normalize("NFKC").trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
export function planSchedule(month: string, input: ScheduleFileRow[], state: ScheduleState) {
  const occurrences = new Map<string, number>();
  const sitesByName = new Map<string, Site[]>();
  const deliveriesBySite = new Map<string, Delivery[]>();
  const driversByName = new Map<string, Driver[]>();
  for (const site of state.sites) {
    const name = normalize(site.name);
    sitesByName.set(name, [...(sitesByName.get(name) ?? []), site]);
  }
  for (const delivery of state.deliveries) {
    deliveriesBySite.set(delivery.siteId, [...(deliveriesBySite.get(delivery.siteId) ?? []), delivery]);
  }
  for (const driver of state.drivers) {
    const name = normalize(driver.name);
    driversByName.set(name, [...(driversByName.get(name) ?? []), driver]);
  }
  for (const row of input) {
    const key = normalize(row.siteName);
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }
  const targets = new Map<number, { deliveryId?: string; siteId: string; driverId: string; deliveryType: string }>();
  const rows: ScheduleReviewRow[] = input.map(row => {
    const review: ScheduleReviewRow = {
      row: row.row, siteName: row.siteName, oldDate: null, newDate: row.plannedDate,
      oldDriver: "", newDriver: row.driverName, status: "conflict", reason: "",
    };
    const reject = (reason: string, status: ScheduleReviewRow["status"] = "conflict") => ({ ...review, status, reason });
    const name = normalize(row.siteName);
    if (!name || occurrences.get(name)! > 1) return reject("Пустой или повторяющийся магазин в файле");
    const sites = sitesByName.get(name) ?? [];
    if (sites.length !== 1) return reject("Магазин не найден однозначно в справочнике объектов");
    const site = sites[0];
    const all = deliveriesBySite.get(site.id) ?? [];
    const ordinary = all.filter(d => !d.orderId);
    // An order's delivery is never inferred to be the ordinary monthly schedule.
    if (!ordinary.length && all.length) return reject("Есть только доставки заказов; они сохранены без изменений", "protected");
    if (ordinary.length > 1) return reject("В месяце несколько доставок магазина — требуется уточнение");
    const delivery = ordinary[0];
    if (delivery) {
      review.oldDate = delivery.plannedDate;
      review.oldDriver = state.drivers.find(d => d.id === delivery.driverUserId)?.name ?? "Не назначен";
      if (delivery.actualDate || delivery.actApprovedAt || delivery.deletionPendingAt ||
          state.frozenIds.includes(delivery.id)) {
        return reject("Выполненная, закрытая или связанная со счётом доставка сохранена", "protected");
      }
    }
    if (row.plannedDate !== null && (!isRealIsoDate(row.plannedDate) || row.plannedDate.slice(0, 7) !== month)) {
      return reject("Нужна корректная дата выбранного месяца или пустая ячейка");
    }
    if (row.plannedDate === null && delivery?.correctedPlannedDate) {
      return reject("Нельзя убрать плановую дату при наличии скорректированной даты");
    }
    const driverName = normalize(row.driverName);
    // Exact name first; accept omitted patronymic only for a unique whole-token match.
    const exact = driversByName.get(driverName) ?? [];
    const words = driverName.split(" ").filter(Boolean);
    const drivers = exact.length ? exact : words.length >= 2
      ? state.drivers.filter(d => words.every(word => normalize(d.name).split(" ").includes(word))) : [];
    if (drivers.length !== 1) return reject("Водитель не найден однозначно; укажите имя из справочника");
    const driver = drivers[0];
    review.newDriver = driver.name;
    targets.set(row.row, { deliveryId: delivery?.id, siteId: site.id, driverId: driver.id, deliveryType: site.deliveryType });
    review.status = !delivery ? "create"
      : delivery.plannedDate === row.plannedDate && delivery.driverUserId === driver.id ? "unchanged" : "update";
    review.reason = review.status === "create" ? "Новая доставка — требуется отдельное подтверждение"
      : review.status === "update" ? "Изменятся только плановая дата и водитель" : "Без изменений";
    return review;
  });
  const fingerprint = createHash("sha256").update(JSON.stringify({ month, input, state })).digest("hex");
  return { rows, fingerprint, targets };
}
