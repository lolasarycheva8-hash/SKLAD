import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markDone = vi.fn();
const refetchDeliveries = vi.fn();
const invalidateQueries = vi.fn();
const toast = vi.fn();
let markDoneMutation: {
  onError?: (error: unknown) => void;
};
let deliveriesQuery: {
  data: typeof ownDelivery[] | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: typeof refetchDeliveries;
};

function todayLocal(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const ownDelivery = {
  id: "own-delivery",
  siteId: "site-1",
  siteName: `Очень-длинное-название-объекта-${"безпробелов".repeat(20)}`,
  siteAddress: "Тестовый адрес",
  managerContact: "+7 (999) 123-45-67",
  driverUserId: "driver-1",
  driver: "Тестовый водитель",
  plannedDate: todayLocal(),
  actualDate: null,
  note: `Длинное-примечание-${"безпробелов".repeat(25)}`,
  photosCount: 0,
  actApprovedAt: null,
  actApprovedBy: null,
  workflowStatus: "planned",
};

vi.mock("@workspace/api-client-react", () => ({
  getListMyDeliveriesQueryKey: () => ["my-deliveries"],
  useListMyDeliveries: () => deliveriesQuery,
  useMarkMyDeliveryDone: (options: { mutation: typeof markDoneMutation }) => {
    markDoneMutation = options.mutation;
    return {
      isPending: false,
      mutate: markDone,
    };
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    user: { id: "driver-1", name: "Тестовый водитель", role: "driver" },
  }),
}));

vi.mock("@/components/delivery-photos-dialog", () => ({
  DeliveryPhotosDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Диалог актов</div> : null,
}));

vi.mock("@/components/delivery-comment-dialog", () => ({
  DeliveryCommentDialog: () => null,
}));

import MyDeliveries from "@/pages/my-deliveries";

describe("мобильная страница водителя", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markDoneMutation = {};
    deliveriesQuery = {
      data: [ownDelivery],
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: refetchDeliveries,
    };
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    window.dispatchEvent(new Event("resize"));
  });

  afterEach(cleanup);

  it("учитывает сегодняшний план без факта как невыполненный", () => {
    render(<MyDeliveries />);

    expect(
      screen.getByRole("button", { name: /План на сегодня\s*1/ }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /Не выполнено\s*1/ }),
    ).not.toBeNull();
  });

  it("удерживает длинное содержимое в узком viewport и оставляет действия доступными", async () => {
    const user = userEvent.setup();
    render(<MyDeliveries />);

    const page = screen.getByTestId("my-deliveries-page");
    const note = screen.getByTestId("delivery-note-own-delivery");
    const card = screen.getByTestId(`delivery-card-${ownDelivery.id}`);
    expect(window.innerWidth).toBe(390);
    expect(page.className).toContain("min-w-0");
    expect(page.className).toContain("overflow-x-hidden");
    expect(card.className).toContain("rounded-xl");
    expect(note.className).toContain("[overflow-wrap:anywhere]");
    expect(note.className).toContain("line-clamp-2");
    expect(screen.getByText(ownDelivery.siteName).className).toContain("[overflow-wrap:anywhere]");
    expect(
      screen
        .getByRole("link", { name: `Позвонить менеджеру объекта ${ownDelivery.siteName}` })
        .getAttribute("href"),
    ).toBe("tel:+79991234567");

    const doneButton = screen.getByRole("button", { name: "Выполнено" });
    const actsButton = screen.getByRole("button", { name: /Акты/ });
    expect(doneButton.className).toContain("h-10");
    expect(actsButton.className).toContain("h-10");
    expect((doneButton as HTMLButtonElement).disabled).toBe(false);
    expect((actsButton as HTMLButtonElement).disabled).toBe(false);

    await user.click(doneButton);
    expect(markDone).toHaveBeenCalledWith({ id: ownDelivery.id });

    await user.click(actsButton);
    expect(screen.getByRole("dialog").textContent).toContain("Диалог актов");
  });

  it("показывает ошибку запроса отдельно от пустого списка и позволяет повторить", async () => {
    deliveriesQuery = {
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: refetchDeliveries,
    };
    const user = userEvent.setup();
    render(<MyDeliveries />);

    expect(screen.getByText("Не удалось загрузить доставки")).not.toBeNull();
    expect(screen.queryByText("Нет доставок")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Загрузить снова" }));
    expect(refetchDeliveries).toHaveBeenCalledOnce();
  });

  it("показывает пустое состояние только после успешного пустого ответа", () => {
    deliveriesQuery = {
      data: [],
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: refetchDeliveries,
    };
    render(<MyDeliveries />);

    expect(screen.getByText("Нет доставок")).not.toBeNull();
    expect(screen.queryByText("Не удалось загрузить доставки")).toBeNull();
  });

  it("при удалённой доставке обновляет список и показывает нейтральное сообщение", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MyDeliveries />);

    await user.click(screen.getByRole("button", { name: "Выполнено" }));
    markDoneMutation.onError?.({
      response: {
        status: 404,
        data: { error: "Delivery not found" },
      },
    });

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

    deliveriesQuery = { ...deliveriesQuery, data: [] };
    rerender(<MyDeliveries />);
    expect(screen.queryByText(ownDelivery.siteName)).toBeNull();
    expect(screen.getByText("Нет доставок")).not.toBeNull();
  });
});
