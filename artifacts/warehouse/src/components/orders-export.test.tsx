import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listOrders: vi.fn(),
  downloadOrdersWorkbook: vi.fn(),
  toast: vi.fn(),
  queryParams: vi.fn(),
  createOrder: vi.fn(),
  canEdit: false,
  isLoading: false,
  orders: [
    {
      id: "order-1", clientId: "client-1", clientName: "Первый", siteId: "site-1",
      siteName: null, siteAddress: null, createdAt: "2026-01-01T00:00:00Z",
      items: [] as Array<{ productId: string; quantity: number; price: number }>, totalAmount: 0, isPaid: false, status: "draft", orderNumber: "Z-1", summaryId: null, fulfillmentDeliveryId: null, note: null, plannedMonth: null, monthFromDelivery: false,
    },
    {
      id: "order-2", clientId: "client-2", clientName: "Второй", siteId: "site-2",
      siteName: null, siteAddress: null, createdAt: "2026-01-02T00:00:00Z",
      items: [] as Array<{ productId: string; quantity: number; price: number }>, totalAmount: 0, isPaid: false, status: "draft", orderNumber: "Z-1", summaryId: null, fulfillmentDeliveryId: null, note: null, plannedMonth: "2027-01", monthFromDelivery: true,
    },
  ],
}));

vi.mock("@workspace/api-client-react", () => ({
  useListOrders: (params?: { plannedMonth?: string }) => {
    mocks.queryParams(params);
    return {
      data: params?.plannedMonth
        ? mocks.orders.filter((order) => params.plannedMonth === "without"
          ? order.plannedMonth === null
          : order.plannedMonth === params.plannedMonth)
        : mocks.orders,
      isLoading: mocks.isLoading,
    };
  },
  listOrders: mocks.listOrders,
  useListOrderClientLookup: () => ({ data: [{ id: "client-1", name: "Первый" }] }),
  useListOrderProductLookup: () => ({ data: [] }),
  useListOrderSiteLookup: () => ({ data: [{ id: "site-1", clientId: "client-1", name: "Магазин", address: "Адрес" }], isLoading: false, isError: false }),
  useCreateOrder: () => ({ mutate: mocks.createOrder, isPending: false }),
  getListOrdersQueryKey: () => ["/api/orders"],
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
  useLocation: () => ["/orders", vi.fn()],
}));
vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({ canEdit: () => mocks.canEdit }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/lib/orders-export", () => ({
  downloadOrdersWorkbook: mocks.downloadOrdersWorkbook,
}));

import Orders from "@/pages/orders";

const initialOrders = mocks.orders.slice();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.isLoading = false;
  mocks.canEdit = false;
  mocks.orders = initialOrders.slice();
  window.history.replaceState({}, "", "/orders?clientId=client-1");
  mocks.listOrders.mockResolvedValue(mocks.orders);
});
afterEach(cleanup);

it("requires a planned month for a new order and blocks direct empty-month submission", () => {
  mocks.canEdit = true;
  render(<Orders />);
  fireEvent.click(screen.getByTestId("button-add-order"));
  const month = screen.getByTestId("input-create-order-month") as HTMLInputElement;
  expect(month.required).toBe(true);
  expect(month.value).toBe("");
  expect(screen.getByTestId("button-save-order")).toHaveProperty("disabled", true);
  fireEvent.submit(month.closest("form")!);
  expect(mocks.createOrder).not.toHaveBeenCalled();
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
});

it("requires an explicit month when copying a historical order and sends it instead of null", () => {
  mocks.canEdit = true;
  mocks.orders = [{
    ...initialOrders[0],
    items: [{ productId: "product-1", quantity: 2, price: 100 }],
  }];
  render(<Orders />);
  fireEvent.click(screen.getByTestId("button-copy-order-order-1"));
  const month = screen.getByTestId("input-create-order-month") as HTMLInputElement;
  expect(month.value).toBe("");
  expect(month.required).toBe(true);
  expect(screen.getByTestId("button-save-order")).toHaveProperty("disabled", true);
  fireEvent.submit(month.closest("form")!);
  expect(mocks.createOrder).not.toHaveBeenCalled();
  fireEvent.change(month, { target: { value: "2027-04" } });
  expect(screen.getByTestId("button-save-order")).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByTestId("input-create-order-delivery-date"), { target: { value: "2027-04-15" } });
  expect(screen.getByTestId("button-save-order")).toHaveProperty("disabled", false);
  fireEvent.click(screen.getByTestId("button-save-order"));
  expect(mocks.createOrder).toHaveBeenCalledWith({
    data: {
      clientId: "client-1", siteId: "site-1", note: undefined, plannedMonth: "2027-04", plannedDeliveryDate: "2027-04-15",
      items: [{ productId: "product-1", quantity: 2, price: 100 }],
    },
  });
});

it("preserves a source order's month when copying, but prevents clearing it", () => {
  mocks.canEdit = true;
  window.history.replaceState({}, "", "/orders");
  render(<Orders />);
  fireEvent.click(screen.getByTestId("button-copy-order-order-2"));
  const month = screen.getByTestId("input-create-order-month") as HTMLInputElement;
  expect(month.value).toBe("2027-01");
  fireEvent.change(month, { target: { value: "" } });
  expect(screen.getByTestId("button-save-order")).toHaveProperty("disabled", true);
  fireEvent.submit(month.closest("form")!);
  expect(mocks.createOrder).not.toHaveBeenCalled();
});

it("exports a fresh unfiltered collection even when URL client filter and search hide orders; read-only users can export", async () => {
  render(<Orders />);
  fireEvent.change(screen.getByTestId("input-search-orders"), { target: { value: "несуществующий" } });
  expect(screen.queryByTestId("row-order-order-2")).toBeNull();
  expect(screen.getByTestId("button-export-all-orders").getAttribute("title")).toMatch(/всех клиентов/);
  fireEvent.click(screen.getByTestId("button-export-all-orders"));
  await waitFor(() => expect(mocks.downloadOrdersWorkbook).toHaveBeenCalledWith(mocks.orders));
  expect(mocks.listOrders).toHaveBeenCalledOnce();
  expect(mocks.listOrders).toHaveBeenCalledWith();
  expect(screen.queryByTestId("button-add-order")).toBeNull();
});

it("shows the effective month and delivery source after a list refresh, without inferring legacy creation month", () => {
  window.history.replaceState({}, "", "/orders");
  const view = render(<Orders />);
  expect(screen.getByTestId("month-order-order-1").textContent).toContain("Без месяца");
  expect(screen.getByTestId("month-order-order-2").textContent).toContain("2027-01");
  expect(screen.getByTestId("month-order-order-2").textContent).toContain("Из доставки");
  mocks.orders = [{ ...initialOrders[0], plannedMonth: "2027-03" }, initialOrders[1]];
  view.rerender(<Orders />);
  expect(screen.getByTestId("month-order-order-1").textContent).toContain("2027-03");
  expect(mocks.queryParams).toHaveBeenLastCalledWith(undefined);
});

it("switches the month selector between all, missing and a chosen future month", async () => {
  window.history.replaceState({}, "", "/orders");
  render(<Orders />);
  const trigger = screen.getByTestId("select-order-month-filter");
  fireEvent.change(trigger, { target: { value: "without" } });
  expect(mocks.queryParams).toHaveBeenLastCalledWith({ plannedMonth: "without" });
  fireEvent.change(trigger, { target: { value: "month" } });
  fireEvent.change(screen.getByTestId("input-order-month-filter"), { target: { value: "2028-02" } });
  expect(mocks.queryParams).toHaveBeenLastCalledWith({ plannedMonth: "2028-02" });
  fireEvent.change(trigger, { target: { value: "all" } });
  expect(mocks.queryParams).toHaveBeenLastCalledWith(undefined);
});

it("keeps legacy missing-month orders separate from current and future months after remount", () => {
  window.history.replaceState({}, "", "/orders");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Moscow", year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  const currentMonth = `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
  const futureMonth = `${Number(currentMonth.slice(0, 4)) + 1}-${currentMonth.slice(5)}`;
  mocks.orders = [
    { ...initialOrders[0], plannedMonth: null },
    { ...initialOrders[1], plannedMonth: currentMonth },
    { ...initialOrders[1], id: "order-future", plannedMonth: futureMonth },
  ];

  const firstMount = render(<Orders />);
  expect(screen.getByTestId("row-order-order-1")).toBeTruthy();
  expect(screen.getByTestId("row-order-order-2")).toBeTruthy();
  expect(screen.getByTestId("row-order-order-future")).toBeTruthy();
  fireEvent.change(screen.getByTestId("select-order-month-filter"), { target: { value: "month" } });
  expect((screen.getByTestId("input-order-month-filter") as HTMLInputElement).value).toBe(currentMonth);
  expect(screen.queryByTestId("row-order-order-1")).toBeNull();
  expect(screen.getByTestId("row-order-order-2")).toBeTruthy();
  expect(screen.queryByTestId("row-order-order-future")).toBeNull();
  firstMount.unmount();

  render(<Orders />);
  expect(screen.getByTestId("row-order-order-1")).toBeTruthy();
  fireEvent.change(screen.getByTestId("select-order-month-filter"), { target: { value: "month" } });
  fireEvent.change(screen.getByTestId("input-order-month-filter"), { target: { value: futureMonth } });
  expect(screen.queryByTestId("row-order-order-2")).toBeNull();
  expect(screen.getByTestId("row-order-order-future")).toBeTruthy();
  fireEvent.change(screen.getByTestId("select-order-month-filter"), { target: { value: "without" } });
  expect(screen.getByTestId("row-order-order-1")).toBeTruthy();
  expect(screen.queryByTestId("row-order-order-future")).toBeNull();
  expect(mocks.queryParams).toHaveBeenLastCalledWith({ plannedMonth: "without" });
});

it("does not download stale orders when fresh fetch fails", async () => {
  mocks.listOrders.mockRejectedValue(new Error("Сервер недоступен"));
  render(<Orders />);
  fireEvent.click(screen.getByTestId("button-export-all-orders"));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
    description: "Сервер недоступен", variant: "destructive",
  })));
  expect(mocks.downloadOrdersWorkbook).not.toHaveBeenCalled();
});

it("does not download a stale or partial workbook when fresh fetch unexpectedly returns empty", async () => {
  mocks.listOrders.mockResolvedValue([]);
  render(<Orders />);
  fireEvent.click(screen.getByTestId("button-export-all-orders"));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
    title: "Не удалось выгрузить заказы", variant: "destructive",
  })));
  expect(mocks.downloadOrdersWorkbook).not.toHaveBeenCalled();
});

it("disables export while list loads or is empty", () => {
  mocks.isLoading = true;
  const view = render(<Orders />);
  expect(screen.getByTestId("button-export-all-orders")).toHaveProperty("disabled", true);
  mocks.isLoading = false;
  mocks.orders = [];
  view.rerender(<Orders />);
  expect(screen.getByTestId("button-export-all-orders")).toHaveProperty("disabled", true);
});