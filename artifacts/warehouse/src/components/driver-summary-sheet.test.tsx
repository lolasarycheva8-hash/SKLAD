import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriverSummarySheet } from "./driver-summary-sheet";
import { buildDriverSummary } from "@/lib/driver-summary";

afterEach(cleanup);

describe("сводка по водителям", () => {
  it("суммирует каждую строку за месяц и считает долю от плана водителя", () => {
    const days = Array.from({ length: 30 }, () => ({ plan: 0, done: 0, closed: 0, failed: 0 }));
    days[0] = { plan: 2, done: 0, closed: 1, failed: 1 };
    days[29] = { plan: 1, done: 1, closed: 0, failed: 0 };
    render(<DriverSummarySheet month="2026-09" rows={[{ key: "monthly", driver: "Водитель", days, undated: 4 }]} />);
    expect(screen.getAllByRole("columnheader").slice(1, 4).map((el) => el.textContent))
      .toEqual(["Показатель", "Итого за месяц, шт", "Итого за месяц, %"]);
    const cells = within(screen.getByTestId("driver-summary-row-monthly")).getAllByRole("cell");
    expect(Array.from(cells[1].querySelectorAll("span")).map((el) => el.textContent)).toEqual(["3", "1", "1", "1"]);
    expect(Array.from(cells[2].querySelectorAll("span")).map((el) => el.textContent)).toEqual(["100%", "33,3%", "33,3%", "33,3%"]);
  });

  it("показывает ожидание и ошибку с повтором, а не нулевые итоги", () => {
    const retry = vi.fn();
    const { rerender } = render(<DriverSummarySheet rows={[]} month="2026-09" isLoading />);
    expect(screen.getByText("Загрузка сводки...")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    rerender(<DriverSummarySheet rows={[]} month="2026-09" isError onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Повторить попытку" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByRole("table")).toBeNull();
    rerender(<DriverSummarySheet rows={[]} month="2026-09" />);
    expect(screen.getByText("Нет данных для отображения.")).toBeTruthy();
  });

  it("показывает все дни, отдельное количество без даты и поиск водителя", () => {
    const rows = buildDriverSummary([{
      driverUserId: "driver-1", driver: "Анна", plannedDate: null,
      actualDate: null, scheduleMonth: "2026-09", workflowStatus: "planned",
    }], [
      { id: "driver-1", name: "Анна", email: "a@example.test" },
      { id: "driver-2", name: "Борис", email: "b@example.test" },
    ], "2026-09");
    render(<DriverSummarySheet rows={rows} month="2026-09" />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(34);
    expect(screen.getAllByRole("columnheader")[1].textContent).toBe("Показатель");
    expect(screen.getByRole("table").classList.contains("table-fixed")).toBe(true);
    expect(screen.getByRole("columnheader", { name: "30.09.2026" })).toBeTruthy();
    expect(screen.getByText("Без даты: 1")).toBeTruthy();
    const row = within(screen.getByTestId("driver-summary-row-driver-1"));
    expect(row.getAllByRole("cell")).toHaveLength(33);
    const labels = within(row.getAllByRole("cell")[0]);
    expect(labels.getByText("План").classList.contains("text-black")).toBe(true);
    expect(labels.getByText("Выполнено").classList.contains("text-orange-800")).toBe(true);
    expect(labels.getByText("Закрыто").classList.contains("text-green-800")).toBe(true);
    expect(labels.getByText("Не выполнено").classList.contains("text-red-600")).toBe(true);
    expect(labels.getByText("Не выполнено").parentElement?.classList.contains("whitespace-nowrap")).toBe(true);
    expect(labels.getByText("Не выполнено").parentElement?.classList.contains("text-[10px]")).toBe(true);
    expect(row.getAllByRole("cell")[1].textContent).toBe("0000");
    expect(row.getAllByRole("cell")[2].textContent).toBe("————");
    expect(row.getAllByTitle("Не выполнено: 0")).toHaveLength(30);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  АННА  " } });
    expect(screen.queryByTestId("driver-summary-row-driver-2")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "нет такого водителя" } });
    expect(screen.getByText("Водители не найдены.")).toBeTruthy();
  });
});