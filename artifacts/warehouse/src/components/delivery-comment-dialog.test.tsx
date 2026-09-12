import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateCommentRequest = vi.fn();
const invalidateQueries = vi.fn();
const toast = vi.fn();
let mutationOptions: any;

vi.mock("@workspace/api-client-react", () => ({
  getListMyDeliveriesQueryKey: () => ["my-deliveries"],
  useUpdateMyDeliveryComment: (options: any) => {
    mutationOptions = options.mutation;
    return {
      isPending: false,
      mutate: (variables: any) => {
        updateCommentRequest(variables).then(
          (data: unknown) => mutationOptions.onSuccess?.(data, variables),
          (error: unknown) => mutationOptions.onError?.(error, variables),
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
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

import { DeliveryCommentDialog } from "./delivery-comment-dialog";

describe("DeliveryCommentDialog", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mutationOptions = undefined;
  });

  it("при 404 закрывает диалог, обновляет список и показывает нейтральное сообщение", async () => {
    updateCommentRequest.mockRejectedValue({ status: 404 });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <DeliveryCommentDialog
        delivery={{ id: "delivery-1", note: "Комментарий" } as never}
        open
        onOpenChange={onOpenChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["my-deliveries"],
    });
    expect(toast).toHaveBeenCalledWith({
      title: "Доставка больше недоступна",
      description: "Список доставок обновлён.",
    });
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("при обычной ошибке оставляет диалог открытым и показывает красное сообщение", async () => {
    updateCommentRequest.mockRejectedValue({
      status: 500,
      response: { data: { error: "Сервис временно недоступен" } },
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <DeliveryCommentDialog
        delivery={{ id: "delivery-1", note: "Комментарий" } as never}
        open
        onOpenChange={onOpenChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: "Ошибка",
        description: "Сервис временно недоступен",
        variant: "destructive",
      }),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("не показывает поздний успех и не закрывает новое открытие после ручного закрытия", async () => {
    let resolveRequest!: (value: unknown) => void;
    updateCommentRequest.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const props = {
      delivery: { id: "delivery-1", note: "Комментарий" } as never,
      onOpenChange,
    };
    const { rerender } = render(<DeliveryCommentDialog {...props} open />);

    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await user.click(screen.getByRole("button", { name: "Отмена" }));
    rerender(<DeliveryCommentDialog {...props} open={false} />);
    rerender(<DeliveryCommentDialog {...props} open />);
    onOpenChange.mockClear();

    resolveRequest({});

    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["my-deliveries"] }),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("не показывает позднюю ошибку после ручного закрытия и нового открытия", async () => {
    let rejectRequest!: (reason: unknown) => void;
    updateCommentRequest.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const props = {
      delivery: { id: "delivery-1", note: "Комментарий" } as never,
      onOpenChange,
    };
    const { rerender } = render(<DeliveryCommentDialog {...props} open />);

    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await user.click(screen.getByRole("button", { name: "Отмена" }));
    rerender(<DeliveryCommentDialog {...props} open={false} />);
    rerender(<DeliveryCommentDialog {...props} open />);
    onOpenChange.mockClear();

    rejectRequest({
      status: 500,
      response: { data: { error: "Сервис временно недоступен" } },
    });

    await waitFor(() => expect(updateCommentRequest).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});