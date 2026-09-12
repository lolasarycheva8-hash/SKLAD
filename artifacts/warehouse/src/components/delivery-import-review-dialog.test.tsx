import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDeliveryImportReview,
  dispatchDeliveryImportByMode,
  type DeliveryImportMode,
} from "@/lib/delivery-workspace";

const { exportRowsToEditableCsv } = vi.hoisted(() => ({
  exportRowsToEditableCsv: vi.fn(),
}));

vi.mock("@/lib/excel-import", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/excel-import")>();
  return {
    ...original,
    exportRowsToEditableCsv,
  };
});

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

import { DeliveryImportReviewDialog } from "./delivery-import-review-dialog";

const review = buildDeliveryImportReview(
  [
    {
      Объект: "Объект Альфа",
      Водитель: "Иван Водитель",
      "Email водителя": "driver@example.test",
      "Плановая дата": "2026-09-15",
    },
    {
      Объект: "Новый объект Гамма",
      Водитель: "Иван Водитель",
      "Email водителя": "driver@example.test",
      "Плановая дата": "2026-09-18",
    },
    {
      Объект: "Новый объект Дельта",
      Водитель: "Иван Водитель",
      "Email водителя": "driver@example.test",
      "Плановая дата": "2026-09-19",
    },
    {
      Объект: "Объект Бета",
      Водитель: "Иван Водитель",
      "Email водителя": "driver@example.test",
      "Плановая дата": "2026-10-02",
    },
    {
      Объект: "Объект Альфа",
      Водитель: "Иван Водитель",
      "Email водителя": "driver@example.test",
      "Плановая дата": "2026-09-15",
    },
  ],
  "2026-09",
  [
    { id: "site-alpha", name: "Объект Альфа", driverUserId: "driver-1" },
    { id: "site-beta", name: "Объект Бета", driverUserId: "driver-1" },
  ],
  [
    {
      id: "driver-1",
      name: "Иван Водитель",
      email: "driver@example.test",
    },
  ],
);

describe("DeliveryImportReviewDialog", () => {
  afterEach(cleanup);

  it("показывает все причины вместе и блокирует загрузку до добавления отсутствующих объектов", async () => {
    const onCancel = vi.fn();
    const onAddMissingSites = vi.fn();
    const addRequest = vi.fn();
    const replaceRequest = vi.fn();
    const user = userEvent.setup();
    render(
      <DeliveryImportReviewDialog
        review={review}
        mode="add"
        onCancel={onCancel}
        onAddMissingSites={onAddMissingSites}
        onConfirm={(items, mode) =>
          dispatchDeliveryImportByMode(items, mode, {
            add: addRequest,
            replace: replaceRequest,
          })
        }
      />,
    );

    expect(screen.getByText(/Допустимых строк: 1/)).toBeTruthy();
    expect(screen.getByRole("heading", {
      name: "Перед загрузкой будут пропущены строки: 4",
    })).toBeTruthy();
    for (const rowNumber of ["3", "4", "5", "6"]) {
      expect(screen.getByText(rowNumber)).toBeTruthy();
    }
    expect(screen.getByText("Объект Бета")).toBeTruthy();
    expect(screen.getByText("Объект Альфа")).toBeTruthy();
    expect(screen.getByText(/относится к другому месяцу/)).toBeTruthy();
    expect(screen.getByText(/Повтор объекта на 2026-09-15/)).toBeTruthy();
    expect(screen.getByText("Новый объект Гамма")).toBeTruthy();
    expect(screen.getByText("Новый объект Дельта")).toBeTruthy();
    expect(screen.getAllByText("Объект не найден в справочнике")).toHaveLength(2);
    expect(
      screen.getByText(/Сначала добавьте отсутствующие объекты в справочник/),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Загрузить остальные" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Добавить отсутствующие объекты" }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Добавить отсутствующие объекты" }),
    );
    expect(onAddMissingSites).toHaveBeenCalledOnce();
    expect(addRequest).not.toHaveBeenCalled();
    expect(replaceRequest).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Скачать отчёт" }));
    expect(exportRowsToEditableCsv).toHaveBeenCalledWith(
      [
        {
          Строка: 3,
          Объект: "Новый объект Гамма",
          Причина: "Объект не найден в справочнике",
        },
        {
          Строка: 4,
          Объект: "Новый объект Дельта",
          Причина: "Объект не найден в справочнике",
        },
        {
          Строка: 5,
          Объект: "Объект Бета",
          Причина:
            "Дата 2026-10-02 относится к другому месяцу; выбран сентябрь 26",
        },
        {
          Строка: 6,
          Объект: "Объект Альфа",
          Причина: "Повтор объекта на 2026-09-15; загружена строка 2",
        },
      ],
      ["Строка", "Объект", "Причина"],
      "пропущенные-строки-импорта.csv",
    );

    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(addRequest).not.toHaveBeenCalled();
    expect(replaceRequest).not.toHaveBeenCalled();
  });

  describe.each(["add", "replace"] as DeliveryImportMode[])(
    "режим %s",
    (mode) => {
      it("подтверждает только допустимые строки и сохраняет выбранный режим", async () => {
        const addRequest = vi.fn();
        const replaceRequest = vi.fn();
        const user = userEvent.setup();
        render(
          <DeliveryImportReviewDialog
            review={{
              items: review.items,
              skippedRows: review.skippedRows.filter(
                (row) => row.reasonCode !== "missing_site",
              ),
            }}
            mode={mode}
            onCancel={vi.fn()}
              onAddMissingSites={vi.fn()}
            onConfirm={(items, confirmedMode) =>
              dispatchDeliveryImportByMode(items, confirmedMode, {
                add: addRequest,
                replace: replaceRequest,
              })
            }
          />,
        );

        await user.click(
          screen.getByRole("button", { name: "Загрузить остальные" }),
        );
        const selectedRequest = mode === "add" ? addRequest : replaceRequest;
        const otherRequest = mode === "add" ? replaceRequest : addRequest;
        expect(selectedRequest).toHaveBeenCalledWith(review.items);
        expect(otherRequest).not.toHaveBeenCalled();
        expect(review.items).toEqual([
          {
            siteId: "site-alpha",
            driverUserId: "driver-1",
            plannedDate: "2026-09-15",
            scheduleMonth: "2026-09",
          },
        ]);
      });
    },
  );
});