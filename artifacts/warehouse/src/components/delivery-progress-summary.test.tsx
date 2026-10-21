import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { DeliveryProgressSummary } from "./delivery-progress-summary";
import { getDeliveryProgress } from "@/lib/delivery-progress";

afterEach(cleanup);

test("period shows completed and closed with the period denominator", () => {
  render(<DeliveryProgressSummary summary={{
    ...getDeliveryProgress([], "2026-10", "2026-10-04"),
    monthPlan: 100, done: 20, closed: 10, periodPlan: 40, periodFact: 20,
    periodClosed: 8, periodNotDone: 20, todayPlan: 10, todayFact: 5, todayClosed: 2,
    start: "2026-10-01", through: "2026-10-03", started: true,
  }} />);
  const period = within(screen.getByTestId("delivery-period-progress"));
  expect(period.getByText("Выполнено").parentElement?.textContent).toContain("20 шт.50%");
  expect(period.getByText("Закрыто").parentElement?.textContent).toContain("8 шт.20%");
  expect(period.getByText("Не выполнено").parentElement?.textContent).toContain("20 шт.50%");
  expect(period.getByText("01.10.2026 — 03.10.2026")).toBeTruthy();
  const today = within(screen.getByTestId("delivery-today-progress"));
  expect(today.getByText("04.10.2026")).toBeTruthy();
  expect(today.getByText("Выполнено").parentElement?.textContent).toContain("5 шт.50%");
  expect(today.getByText("Закрыто").parentElement?.textContent).toContain("2 шт.20%");
  expect(period.queryByText("Факт")).toBeNull();
  const month = within(screen.getByTestId("delivery-month-progress"));
  expect(month.getByText("Закрыто").parentElement?.textContent).toContain("10 шт.10%");
  expect(month.getByText("Выполнено").parentElement?.textContent).toContain("20 шт.20%");
});

test("empty period keeps both metrics without invalid percentages", () => {
  render(<DeliveryProgressSummary summary={{
    ...getDeliveryProgress([], "2026-10", "2026-10-04"),
    monthPlan: 0, done: 0, closed: 0, periodPlan: 0, periodFact: 0,
    start: "2026-10-01", through: "2026-10-04", started: true,
  }} />);
  const period = within(screen.getByTestId("delivery-period-progress"));
  for (const title of ["Выполнено", "Закрыто", "Не выполнено"]) {
    expect(period.getByText(title).parentElement?.textContent).toContain("0 шт.—");
  }
});