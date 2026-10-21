import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
const invalidateQueries = vi.fn();
const toast = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  getListDeliveriesQueryKey: () => ["deliveries"],
  useUpdateDelivery: (options: any) => {
    const [isPending, setPending] = React.useState(false);

    return {
      isPending,
      mutate: (variables: any) => {
        setPending(true);
        request(variables).then(
          (data: unknown) => {
            options.mutation.onSuccess?.(data, variables);
            setPending(false);
          },
          (error: unknown) => {
            options.mutation.onError?.(error, variables);
            setPending(false);
          },
        );
      },
    };
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open: boolean;
  }) => (
    <>
      {React.Children.toArray(children)[0]}
      {open ? React.Children.toArray(children).slice(1) : null}
    </>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
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

import { CorrectedPlanDateCell } from "./corrected-plan-date-cell";

describe("CorrectedPlanDateCell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    request.mockResolvedValue({});
  });

  afterEach(cleanup);

  it("показывает только форматированную дату пользователю без права изменения", () => {
    render(
      <CorrectedPlanDateCell
        deliveryId="delivery-1"
        siteName="Объект 1"
        value="2026-05-07"
        canEdit={false}
      />,
    );

    expect(screen.getByText("07.05.2026")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("открывает текущую дату и отправляет изменение только при сохранении", async () => {
    const user = userEvent.setup();
    render(
      <CorrectedPlanDateCell
        deliveryId="delivery-2"
        siteName="Склад Север"
        value="2026-05-07"
        canEdit
      />,
    );

    await user.click(
      screen.getByTestId("button-corrected-plan-date-delivery-2"),
    );
    const input = screen.getByTestId("input-corrected-plan-date");
    expect((input as HTMLInputElement).value).toBe("2026-05-07");
    expect(screen.getByText("Склад Север")).toBeTruthy();
    expect(
      screen.getByText(/Только для информации\. График и просрочка/),
    ).toBeTruthy();

    await user.clear(input);
    await user.type(input, "2026-06-12");
    expect(request).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("button-save-corrected-plan-date"));
    expect(request).toHaveBeenCalledWith({
      id: "delivery-2",
      data: { correctedPlannedDate: "2026-06-12" },
    });
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["deliveries"],
      }),
    );
    expect(toast).toHaveBeenCalledWith({
      title: "Уточнённая дата сохранена",
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull(),
    );
  });

  it("очищает дату черновиком и отправляет null только при сохранении", async () => {
    const user = userEvent.setup();
    render(
      <CorrectedPlanDateCell
        deliveryId="delivery-3"
        siteName="Склад Юг"
        value="2026-07-09"
        canEdit
      />,
    );

    await user.click(
      screen.getByTestId("button-corrected-plan-date-delivery-3"),
    );
    await user.click(screen.getByTestId("button-clear-corrected-plan-date"));
    expect(
      (screen.getByTestId("input-corrected-plan-date") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(request).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("button-save-corrected-plan-date"));
    expect(request).toHaveBeenCalledWith({
      id: "delivery-3",
      data: { correctedPlannedDate: null },
    });
  });

  it("блокирует повторное сохранение и при ошибке сохраняет открытый черновик", async () => {
    let rejectRequest!: (error: Error) => void;
    request.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
    );
    const user = userEvent.setup();
    render(
      <CorrectedPlanDateCell
        deliveryId="delivery-4"
        siteName="Склад Запад"
        value={null}
        canEdit
        compact
      />,
    );

    expect(
      screen.getByTestId("button-corrected-plan-date-delivery-4").textContent,
    ).toContain("—");
    await user.click(
      screen.getByTestId("button-corrected-plan-date-delivery-4"),
    );
    const input = screen.getByTestId("input-corrected-plan-date");
    await user.type(input, "2026-08-15");
    await user.click(screen.getByTestId("button-save-corrected-plan-date"));

    expect(
      (screen.getByTestId(
        "button-save-corrected-plan-date",
      ) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((input as HTMLInputElement).disabled).toBe(true);
    await user.click(screen.getByTestId("button-save-corrected-plan-date"));
    expect(request).toHaveBeenCalledTimes(1);

    rejectRequest(new Error("Сеть недоступна"));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: "Не удалось сохранить уточнённую дату",
        description: "Сеть недоступна",
        variant: "destructive",
      }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      (screen.getByTestId("input-corrected-plan-date") as HTMLInputElement)
        .value,
    ).toBe("2026-08-15");
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});