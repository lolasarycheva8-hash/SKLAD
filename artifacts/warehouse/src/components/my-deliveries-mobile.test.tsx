import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { formatMoscowDate } from "@/lib/moscow-date";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markDone = vi.fn();
const refetchDeliveries = vi.fn();
const invalidateQueries = vi.fn();
const toast = vi.fn();
const listMyDeliveries = vi.fn();
let allDatesDeliveries: typeof ownDelivery[] | undefined;
let markDoneMutation: {
  onError?: (error: unknown) => void;
  onSuccess?: () => void;
};
let deliveriesQuery: {
  data: typeof ownDelivery[] | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: typeof refetchDeliveries;
};

function todayLocal(): string {
  return formatMoscowDate();
}

const ownDelivery = {
  id: "own-delivery",
  siteId: "site-1",
  siteName: `Очень-длинное-название-объекта-${"безпробелов".repeat(20)}`,
  siteAddress: "Тестовый адрес",
  tradeNetworkName: null as string | null | undefined,
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
  useListMyDeliveries: (params: unknown) => {
    listMyDeliveries(params);
    if (allDatesDeliveries && (params === undefined || !(params as { from?: string }).from)) {
      return { ...deliveriesQuery, data: allDatesDeliveries };
    }
    return deliveriesQuery;
  },
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
  DeliveryPhotosDialog: ({ open, delivery }: { open: boolean; delivery?: { id: string } }) =>
    open ? <div role="dialog" data-delivery-id={delivery?.id}>Диалог актов</div> : null,
}));

vi.mock("@/components/delivery-comment-dialog", () => ({
  DeliveryCommentDialog: () => null,
}));

import MyDeliveries from "@/pages/my-deliveries";

describe("мобильная страница водителя", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allDatesDeliveries = undefined;
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

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("показывает торговую сеть из карточки объекта отдельно от названия и адреса", () => {
    deliveriesQuery.data = [{ ...ownDelivery, tradeNetworkName: "Верный" }];
    render(<MyDeliveries />);
    expect(screen.getByTestId("delivery-trade-network-own-delivery").textContent).toBe("Торговая сеть: Верный");
    expect(screen.getByTestId("delivery-site-name-own-delivery").textContent).toBe(ownDelivery.siteName);
    expect(screen.getByText(ownDelivery.siteAddress)).toBeTruthy();
  });

  it.each([null, undefined, "", "   "])("не показывает пустую строку сети: %s", (tradeNetworkName) => {
    deliveriesQuery.data = [{ ...ownDelivery, tradeNetworkName }];
    render(<MyDeliveries />);
    expect(screen.queryByTestId("delivery-trade-network-own-delivery")).toBeNull();
  });

  it("переходит в новый московский день и месяц, не закрывая акт прежней доставки", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T20:59:59Z"));
    render(<MyDeliveries />);
    expect((screen.getByLabelText("Дата доставок") as HTMLInputElement).value).toBe("2026-10-31");
    fireEvent.click(screen.getByRole("button", { name: "Акты" }));
    act(() => vi.advanceTimersByTime(1000));
    expect((screen.getByLabelText("Дата доставок") as HTMLInputElement).value).toBe("2026-11-01");
    expect(listMyDeliveries).toHaveBeenLastCalledWith({ from: "2026-11-01", to: "2026-11-01", search: undefined });
    expect(screen.getByRole("dialog").getAttribute("data-delivery-id")).toBe(ownDelivery.id);
    expect(screen.getByText("Сегодня")).toBeTruthy();
  });

  it.each(["2026-10-05", "2026-11-01"])("сохраняет вручную выбранную дату %s после полуночи", (selected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T20:59:59Z"));
    render(<MyDeliveries />);
    fireEvent.change(screen.getByLabelText("Дата доставок"), { target: { value: selected } });
    act(() => vi.advanceTimersByTime(1000));
    act(() => vi.advanceTimersByTime(86400000));
    expect((screen.getByLabelText("Дата доставок") as HTMLInputElement).value).toBe(selected);
    expect(listMyDeliveries).toHaveBeenLastCalledWith({ from: selected, to: selected, search: undefined });
  });

  it.each(["focus", "pageshow", "visibilitychange"])("обновляет московский день при %s после остановки таймеров в фоне", (event) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T20:00:00Z"));
    render(<MyDeliveries />);
    vi.setSystemTime(new Date("2026-10-17T21:01:00Z"));
    act(() => {
      if (event === "visibilitychange") {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
        document.dispatchEvent(new Event(event));
      } else {
        window.dispatchEvent(new Event(event));
      }
    });
    expect((screen.getByLabelText("Дата доставок") as HTMLInputElement).value).toBe("2026-10-18");
  });

  it("возвращается в режим сегодня после выбора текущего дня и удаляет таймер при уходе", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T20:59:59Z"));
    const { unmount } = render(<MyDeliveries />);
    fireEvent.click(screen.getByRole("button", { name: "Предыдущий день" }));
    expect((screen.getByLabelText("Дата доставок") as HTMLInputElement).value).toBe("2026-12-30");
    fireEvent.click(screen.getByRole("button", { name: "Следующий день" }));
    act(() => vi.advanceTimersByTime(1000));
    expect((screen.getByLabelText("Дата доставок") as HTMLInputElement).value).toBe("2027-01-01");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("сохраняет фильтр без акта и поиск при смене дня", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T20:59:59Z"));
    render(<MyDeliveries />);
    fireEvent.click(screen.getByRole("button", { name: "Выполнено без акта" }));
    act(() => vi.advanceTimersByTime(1000));
    expect(listMyDeliveries).toHaveBeenLastCalledWith({ from: undefined, to: undefined, search: undefined });
    fireEvent.change(screen.getByPlaceholderText("Поиск по объекту или адресу..."), { target: { value: "Тестовый" } });
    act(() => vi.advanceTimersByTime(86400000));
    expect(listMyDeliveries).toHaveBeenLastCalledWith({ from: undefined, to: undefined, search: "Тестовый" });
  });

  it("показывает без акта только выбранный месяц, очищает поиск и меняет счётчик при смене месяца", async () => {
    const pending = { ...ownDelivery, id: "old-missing", siteName: "Объект месяца", plannedDate: `${todayLocal().slice(0, 7)}-01`, actualDate: todayLocal() as any, workflowStatus: "done" };
    allDatesDeliveries = [
      pending,
      { ...pending, id: "other-month", plannedDate: "2025-09-02" },
      { ...pending, id: "other-month-2", plannedDate: "2025-09-03" },
      { ...pending, id: "has-act", photosCount: 1 },
      { ...pending, id: "closed", workflowStatus: "closed" },
      ownDelivery,
    ];
    const user = userEvent.setup();
    render(<MyDeliveries />);
    expect(screen.getByTestId("missing-acts-notice")).not.toBeNull();
    expect(screen.queryByTestId("delivery-card-old-missing")).toBeNull();
    await user.type(screen.getByPlaceholderText("Поиск по объекту или адресу..."), "другой");
    await user.click(screen.getByRole("link", { name: "Открыть доставки без акта (1)" }));
    expect(listMyDeliveries).toHaveBeenLastCalledWith({ from: undefined, to: undefined, search: undefined });
    expect(screen.getByTestId("delivery-card-old-missing")).not.toBeNull();
    expect(screen.queryByTestId("delivery-card-has-act")).toBeNull();
    expect(screen.queryByTestId("delivery-card-closed")).toBeNull();
    expect(screen.queryByTestId("delivery-card-own-delivery")).toBeNull();
    expect(screen.queryByTestId("delivery-card-other-month")).toBeNull();
    fireEvent.change(screen.getByLabelText("Дата доставок"), { target: { value: "2025-09-07" } });
    expect(screen.getByRole("link", { name: "Открыть доставки без акта (2)" })).not.toBeNull();
    expect(screen.queryByTestId("delivery-card-old-missing")).toBeNull();
    expect(screen.getByTestId("delivery-card-other-month")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Дата доставок"), { target: { value: "2025-12-07" } });
    expect(screen.queryByTestId("missing-acts-notice")).toBeNull();
    expect(screen.queryByTestId("delivery-card-other-month")).toBeNull();
  });

  it("убирает напоминание после прикрепления акта", () => {
    deliveriesQuery.data = [{ ...ownDelivery, actualDate: todayLocal() as any, workflowStatus: "done" }];
    const view = render(<MyDeliveries />);
    expect(screen.getByTestId("missing-acts-notice")).not.toBeNull();
    deliveriesQuery.data = [{ ...deliveriesQuery.data![0], photosCount: 1 }];
    view.rerender(<MyDeliveries />);
    expect(screen.queryByTestId("missing-acts-notice")).toBeNull();
  });

  it("не напоминает о доставках, которые ещё не выполнены", () => {
    render(<MyDeliveries />);
    expect(screen.queryByTestId("missing-acts-notice")).toBeNull();
  });

  it("ищет часть слова за все дни и возвращает выбранную дату после очистки", async () => {
    const user = userEvent.setup();
    deliveriesQuery.data = [{ ...ownDelivery, plannedDate: "2026-09-08" }];
    render(<MyDeliveries />);
    const input = screen.getByPlaceholderText("Поиск по объекту или адресу...");
    expect(listMyDeliveries).toHaveBeenLastCalledWith({
      from: todayLocal(), to: todayLocal(), search: undefined,
    });
    await user.type(input, "Вито");
    expect(listMyDeliveries).toHaveBeenLastCalledWith({
      from: undefined, to: undefined, search: "Вито",
    });
    expect(screen.getByText("Поиск по всем дням")).not.toBeNull();
    expect(screen.getByText("План: 08.09.2026")).not.toBeNull();
    expect(screen.getByRole("button", { name: /План за все дни/ })).not.toBeNull();
    await user.clear(input);
    await user.type(input, " ");
    expect(listMyDeliveries).toHaveBeenLastCalledWith({
      from: todayLocal(), to: todayLocal(), search: undefined,
    });
    expect(screen.queryByText("Поиск по всем дням")).toBeNull();
  });

  it("учитывает сегодняшний план без факта как невыполненный", () => {
    render(<MyDeliveries />);

    expect(
      screen.getByRole("button", { name: /План на сегодня\s*1/ }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /Не выполнено\s*1/ }),
    ).not.toBeNull();
  });

  it("показывает выполненные без акта за месяц, возвращает дату при выходе из фильтра", async () => {
    const user = userEvent.setup();
    render(<MyDeliveries />);
    await user.click(screen.getByRole("button", { name: "Выполнено без акта" }));
    expect(listMyDeliveries).toHaveBeenLastCalledWith({ from: undefined, to: undefined, search: undefined });
    expect(screen.queryByTestId("delivery-card-own-delivery")).toBeNull();
    await user.click(screen.getByRole("button", { name: /План на сегодня/ }));
    expect(listMyDeliveries).toHaveBeenLastCalledWith({ from: todayLocal(), to: todayLocal(), search: undefined });
    expect(screen.getByTestId("delivery-card-own-delivery")).not.toBeNull();
  });

  it("оставляет выполненный адрес на том же месте в маршруте", () => {
    const view = render(<MyDeliveries />);
    deliveriesQuery.data = [{ ...ownDelivery, actualDate: todayLocal() as any, workflowStatus: "done" }];
    view.rerender(<MyDeliveries />);
    expect(screen.getByTestId("delivery-card-own-delivery")).not.toBeNull();
    expect(screen.getByText("Выполнено · Нет акта")).not.toBeNull();
    expect(screen.getByTestId("button-acts-own-delivery")).not.toBeNull();
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

  it.each([
    {
      scenario: "ошибке сервера с понятным текстом",
      error: { response: { status: 500, data: { error: "Не удалось сохранить отметку доставки" } }, message: "HTTP 500" },
      message: "Не удалось сохранить отметку доставки",
    },
    {
      scenario: "отказе доступа",
      error: { response: { status: 403, data: { error: "Нет прав для изменения доставки" } }, message: "HTTP 403" },
      message: "Нет прав для изменения доставки",
    },
    {
      scenario: "ответе сервера без поля error",
      error: { response: { status: 503 }, message: "Сервис временно недоступен" },
      message: "Сервис временно недоступен",
    },
    {
      scenario: "сетевом сбое без HTTP-ответа",
      error: new TypeError("Не удалось соединиться с сервером"),
      message: "Не удалось соединиться с сервером",
    },
  ])("при $scenario показывает красное предупреждение, а не недоступную доставку", async ({ error, message }) => {
    const user = userEvent.setup();
    render(<MyDeliveries />);
    await user.click(screen.getByRole("button", { name: "Выполнено" }));
    expect(markDone).toHaveBeenCalledWith({ id: ownDelivery.id });
    expect(markDoneMutation.onError).toBeTypeOf("function");
    act(() => markDoneMutation.onError!(error));

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({
      title: "Ошибка",
      description: message,
      variant: "destructive",
    });
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({
      title: "Доставка больше недоступна",
    }));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({
      title: "Доставка отмечена выполненной",
    }));
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(screen.getByText(ownDelivery.siteName)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Выполнено" })).toBeTruthy();
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
