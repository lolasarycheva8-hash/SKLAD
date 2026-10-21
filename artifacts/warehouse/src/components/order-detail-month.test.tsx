import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateOrder: vi.fn(),
  createOrder: vi.fn(),
  month: null as string | null,
  monthFromDelivery: false,
  deliveryFromAdditionalOrder: false,
  fulfillmentDeliveryId: null as string | null,
  siteId: null as string | null,
  summaryId: null as string | null,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetOrder: () => ({
    data: {
      id: "order-1", clientId: "client-1", clientName: "Клиент",
      siteId: mocks.siteId, siteName: null, siteAddress: null,
      plannedMonth: mocks.month, monthFromDelivery: mocks.monthFromDelivery,
      deliveryFromAdditionalOrder: mocks.deliveryFromAdditionalOrder,
      isPaid: false, status: mocks.summaryId ? "awaiting_payment" : "draft", orderNumber: "Z-1", summaryId: mocks.summaryId, fulfillmentDeliveryId: mocks.fulfillmentDeliveryId, paidAmount: 0, overpaidAmount: 0, totalAmount: 200,
      note: null, createdAt: "2026-01-01T00:00:00Z",
      items: [{
        id: "item-1", productId: "product-1", productName: "Товар",
        quantity: 2, price: 100, shippedQuantity: 0, remainingQuantity: 2,
      }],
    },
    isLoading: false,
  }),
  useUpdateOrder: () => ({ mutate: mocks.updateOrder, isPending: false }),
  useCreateOrder: () => ({ mutate: mocks.createOrder, isPending: false }),
  useDeleteOrder: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateShipment: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateOrderPayment: () => ({ mutate: vi.fn(), isPending: false }),
  useListShipmentSiteLookup: () => ({ data: [] }),
  useListDrivers: () => ({ data: [] }),
  useListOrderShipmentLookup: () => ({ data: [] }),
  useListOrderProductLookup: () => ({ data: [] }),
  useListOrderSiteLookup: () => ({ data: [{ id: "site-1", clientId: "client-1", name: "Магазин", address: "Адрес" }], isLoading: false, isError: false }),
  useListOrderPayments: () => ({ data: [] }),
  useListDeliveries: () => ({
    data: mocks.fulfillmentDeliveryId ? [{
      id: mocks.fulfillmentDeliveryId, siteId: mocks.siteId, siteName: "Магазин",
      plannedDate: "2027-03-15", actualDate: null, scheduleMonth: "2027-03",
      parentDeliveryId: null, orderId: null, archivedAt: null,
    }] : [],
    isLoading: false, isError: false,
  }),
  getListDeliveriesQueryKey: () => ["/api/deliveries"],
  getListOrderSummariesQueryKey: () => ["/api/order-summaries"],
  getGetOrderQueryKey: () => ["/api/orders/order-1"],
  getListOrderShipmentLookupQueryKey: () => ["/api/orders/order-1/shipments"],
  getListOrdersQueryKey: () => ["/api/orders"],
  getListOrderPaymentsQueryKey: () => ["/api/orders/order-1/payments"],
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
  useLocation: () => ["/orders/order-1", vi.fn()],
  useParams: () => ({ id: "order-1" }),
}));
vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({ canEdit: (section: string) => section === "orders" }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import OrderDetail from "@/pages/order-detail";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.month = null;
  mocks.monthFromDelivery = false;
  mocks.deliveryFromAdditionalOrder = false;
  mocks.fulfillmentDeliveryId = null;
  mocks.siteId = null;
  mocks.summaryId = null;
});
afterEach(cleanup);

it("keeps a historical month empty until explicitly chosen and saves only a non-null month", () => {
  render(<OrderDetail />);
  fireEvent.click(screen.getByTestId("button-edit-order-month"));
  const month = screen.getByTestId("input-edit-order-month") as HTMLInputElement;
  expect(month.value).toBe("");
  expect(month.required).toBe(true);
  const save = screen.getByTestId("button-save-order-month");
  expect(save).toHaveProperty("disabled", true);
  fireEvent.click(save);
  expect(mocks.updateOrder).not.toHaveBeenCalled();
  fireEvent.change(month, { target: { value: "2028-02" } });
  expect(save).toHaveProperty("disabled", false);
  fireEvent.click(save);
  expect(mocks.updateOrder).toHaveBeenCalledWith(
    { id: "order-1", data: { plannedMonth: "2028-02" } },
    expect.any(Object),
  );
});

it("prevents clearing an existing standalone order month", () => {
  mocks.month = "2027-03";
  render(<OrderDetail />);
  fireEvent.click(screen.getByTestId("button-edit-order-month"));
  const month = screen.getByTestId("input-edit-order-month") as HTMLInputElement;
  expect(month.value).toBe("2027-03");
  fireEvent.change(month, { target: { value: "" } });
  expect(screen.getByTestId("button-save-order-month")).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByTestId("button-save-order-month"));
  expect(mocks.updateOrder).not.toHaveBeenCalled();
});

it("does not expose standalone month editing for an order linked to a delivery", () => {
  mocks.month = "2027-03";
  mocks.monthFromDelivery = true;
  render(<OrderDetail />);
  expect(screen.queryByTestId("button-edit-order-month")).toBeNull();
});
it("ordinary linked delivery shows its date and permits changing/clearing the link, not its derived month", () => {
  mocks.month = "2027-03";
  mocks.monthFromDelivery = true;
  mocks.fulfillmentDeliveryId = "delivery-1";
  mocks.siteId = "site-1";
  render(<OrderDetail />);
  expect(screen.getByTestId("text-linked-delivery").textContent).toContain("Привязана доставка на");
  expect(screen.queryByText(/Заказ создан из доставки \(дополнительный заказ\)/)).toBeNull();
  expect(screen.getByTestId("button-edit-order-delivery")).toHaveProperty("disabled", false);
  expect(screen.queryByTestId("button-edit-order-month")).toBeNull();
  fireEvent.click(screen.getByTestId("button-edit-order-delivery"));
  expect(screen.getByTestId("select-order-delivery")).toBeDefined();
});
it("only an actual additional-order link is read-only in the delivery block", () => {
  mocks.month = "2027-03";
  mocks.monthFromDelivery = true;
  mocks.deliveryFromAdditionalOrder = true;
  mocks.fulfillmentDeliveryId = "delivery-1";
  mocks.siteId = "site-1";
  render(<OrderDetail />);
  expect(screen.getByText(/Для заказа создана отдельная доставка/)).toBeDefined();
  expect(screen.queryByTestId("button-edit-order-delivery")).toBeNull();
  expect(screen.queryByTestId("button-edit-order-month")).toBeNull();
});
it("billing freezes an ordinary explicit delivery link", () => {
  mocks.month = "2027-03";
  mocks.monthFromDelivery = true;
  mocks.fulfillmentDeliveryId = "delivery-1";
  mocks.siteId = "site-1";
  mocks.summaryId = "summary-1";
  render(<OrderDetail />);
  expect(screen.getByTestId("text-linked-delivery")).toBeDefined();
  expect(screen.queryByTestId("button-edit-order-delivery")).toBeNull();
});

it("requires a month to copy a historical order from its detail page", () => {
  mocks.siteId = "site-1";
  render(<OrderDetail />);
  fireEvent.click(screen.getByTestId("button-copy-order"));
  const month = screen.getByTestId("input-copy-order-month") as HTMLInputElement;
  expect(month.value).toBe("");
  expect(month.required).toBe(true);
  const copy = screen.getByTestId("button-confirm-copy-order");
  expect(copy).toHaveProperty("disabled", true);
  fireEvent.click(copy);
  expect(mocks.createOrder).not.toHaveBeenCalled();
  fireEvent.change(month, { target: { value: "2027-05" } });
  expect(copy).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByTestId("input-copy-order-delivery-date"), { target: { value: "2027-05-15" } });
  expect(copy).toHaveProperty("disabled", false);
  fireEvent.click(copy);
  expect(mocks.createOrder).toHaveBeenCalledWith({
    data: {
      clientId: "client-1", siteId: "site-1", note: undefined, plannedMonth: "2027-05", plannedDeliveryDate: "2027-05-15",
      items: [{ productId: "product-1", quantity: 2, price: 100 }],
    },
  });
});