import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeliveryMonthSelector } from "./delivery-month-selector";

afterEach(cleanup);

function mountSelector(initial = "2026-10") {
  const change = vi.fn();
  function ControlledSelector() {
    const [value, setValue] = useState(initial);
    return <DeliveryMonthSelector value={value} onChange={(month) => {
      change(month);
      setValue(month);
    }} />;
  }
  const rendered = render(<ControlledSelector />);
  return { ...rendered, change };
}

describe("delivery month selection without a native month input", () => {
  it("opens September from October with one click and can go forward again", async () => {
    const { container, change } = mountSelector();
    const user = userEvent.setup();
    expect(container.querySelector('input[type="month"]')).toBeNull();
    expect(screen.getByRole("combobox", { name: "Выбрать месяц" })).toBeTruthy();
    expect((screen.getByLabelText("Выбрать год") as HTMLInputElement).value).toBe("2026");

    await user.click(screen.getByRole("button", { name: "Предыдущий месяц" }));
    expect(change).toHaveBeenLastCalledWith("2026-09");
    expect(screen.getByTestId("text-selected-delivery-month").textContent).toBe("Сентябрь 2026");
    expect((screen.getByLabelText("Выбрать месяц") as HTMLSelectElement).value).toBe("09");

    await user.click(screen.getByRole("button", { name: "Следующий месяц" }));
    expect(change).toHaveBeenLastCalledWith("2026-10");
  });

  it("selects any month and an earlier year using visible labeled controls", async () => {
    const { change } = mountSelector();
    const user = userEvent.setup();
    const month = screen.getByLabelText("Выбрать месяц");
    const year = screen.getByLabelText("Выбрать год");
    expect(month.hasAttribute("min")).toBe(false);
    expect(year.hasAttribute("min")).toBe(false);
    await user.selectOptions(month, "09");
    expect(change).toHaveBeenLastCalledWith("2026-09");
    await user.clear(year);
    await user.type(year, "2020");
    expect(change).toHaveBeenLastCalledWith("2020-09");
    expect(screen.getByTestId("text-selected-delivery-month").textContent).toBe("Сентябрь 2020");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps partial/invalid year drafts out of requests, explains errors, and recovers", async () => {
    const { change } = mountSelector();
    const year = screen.getByLabelText("Выбрать год");
    for (const value of ["", "20", "0000", "0999", "abcd", "10000"]) {
      fireEvent.change(year, { target: { value } });
      fireEvent.blur(year);
      expect(change).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toContain("Введите год из 4 цифр");
      expect(year.getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByTestId("text-selected-delivery-month").textContent).toBe("Октябрь 2026");
    }
    fireEvent.keyDown(year, { key: "Escape" });
    expect((year as HTMLInputElement).value).toBe("2026");
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(year, { target: { value: "20" } });
    fireEvent.keyDown(year, { key: "Enter" });
    expect(change).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Предыдущий месяц" }));
    expect(change).toHaveBeenLastCalledWith("2026-09");
    expect((year as HTMLInputElement).value).toBe("2026");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("crosses both year boundaries without date or locale normalization", async () => {
    const { change } = mountSelector("2026-01");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Предыдущий месяц" }));
    expect(change).toHaveBeenLastCalledWith("2025-12");
    expect((screen.getByLabelText("Выбрать год") as HTMLInputElement).value).toBe("2025");
    await user.click(screen.getByRole("button", { name: "Следующий месяц" }));
    expect(change).toHaveBeenLastCalledWith("2026-01");
  });

  it.each([
    ["1000-01", "Предыдущий месяц"],
    ["9999-12", "Следующий месяц"],
  ])("only disables navigation beyond the API year contract at %s", (value, label) => {
    mountSelector(value);
    expect((screen.getByRole("button", { name: label }) as HTMLButtonElement).disabled).toBe(true);
  });
});