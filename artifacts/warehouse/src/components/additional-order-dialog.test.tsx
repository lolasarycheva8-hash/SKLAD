import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Delivery } from "@workspace/api-client-react";

const { mutateAsync, toast } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListDeliveryTypes: () => ({
    data: [
      { id: "type-pallet", name: "Палета" },
      { id: "type-box", name: "Коробка" },
      ...["закрытие", "открывашка", "отмывка"].map(name => ({ id: name, name })),
    ],
    isError: false,
  }),
  useListOrderProductLookup: () => ({
    data: [{ id: "product-1", name: "Плита", unit: "шт", price: 100 }],
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useCreateAdditionalDeliveryOrder: () => ({ mutateAsync }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

// The production Select is Radix-based. A native test double keeps this test
// focused on the flow and request payload rather than portal pointer events.
vi.mock("@/components/ui/select", () => {
  function NativeSelectItem({
    value,
    children,
  }: {
    value?: string;
    children: React.ReactNode;
  }) {
    return <option value={value}>{children}</option>;
  }
  function NativeSelectTrigger() {
    return null;
  }
  function NativeSelectContent({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }
  function NativeSelectValue() {
    return null;
  }
  function collect(
    node: React.ReactNode,
    options: React.ReactElement[],
    metadata: { testId?: string },
  ) {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      if (child.type === NativeSelectItem) {
        options.push(child);
        return;
      }
      if (child.type === NativeSelectTrigger) {
        const props = child.props as {
          "data-testid"?: string;
          children?: React.ReactNode;
        };
        const testId = props["data-testid"];
        if (testId) metadata.testId = testId;
      }
      collect(
        (child.props as { children?: React.ReactNode }).children,
        options,
        metadata,
      );
    });
  }
  function NativeSelect({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) {
    const options: React.ReactElement[] = [];
    const metadata: { testId?: string } = {};
    collect(children, options, metadata);
    return (
      <select
        value={value}
        data-testid={metadata.testId}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        {options.map((option) =>
          React.cloneElement(option, {
            key: (option.props as { value?: string }).value,
          }),
        )}
      </select>
    );
  }
  return {
    Select: NativeSelect,
    SelectItem: NativeSelectItem,
    SelectTrigger: NativeSelectTrigger,
    SelectContent: NativeSelectContent,
    SelectValue: NativeSelectValue,
  };
});

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
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

import { AdditionalOrderDialog } from "@/components/additional-order-dialog";

const delivery: Delivery = {
  id: "source-delivery",
  siteId: "site-1",
  siteName: "Объект",
  siteAddress: "Адрес",
  clientId: "client-1",
  clientName: "Клиент",
  managerContact: null,
  driverUserId: "driver-1",
  driver: "Водитель",
  parentDeliveryId: null,
  orderId: null,
  plannedDate: "2026-01-01",
  correctedPlannedDate: null,
  deliveryType: "Коробка",
  scheduleMonth: "2026-01",
  actualDate: null,
  actApprovedAt: null,
  actApprovedBy: null,
  workflowStatus: "planned",
  note: null,
  logisticianNote: null,
  status: "pending",
  lagDays: null,
  rescheduledFromDate: null,
  rescheduledBy: null,
  rescheduledAt: null,
  photosCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
  archivedByName: null,
  additionalOrderItems: [
    { productId: "product-1", productName: "Плита", quantity: 2, unit: "шт" },
  ],
  hasAdditionalOrders: false,
};

describe("additional order dialog", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["закрытие", "открывашка", "отмывка"])("сохраняет %s без выбора продукции и без скопированных товаров", async (type) => {
    mutateAsync.mockResolvedValueOnce({ orderId: "order-service", deliveryId: "delivery-service" });
    const onSuccess = vi.fn();
    render(<AdditionalOrderDialog delivery={delivery} open onCancel={vi.fn()} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByTestId("select-additional-order-delivery-type"), { target: { value: type } });
    fireEvent.click(screen.getByTestId("button-continue-additional-order"));
    expect(screen.queryByTestId("input-additional-order-item-quantity-0")).toBeNull();
    fireEvent.click(screen.getByTestId("button-save-additional-order"));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ deliveryType: type, items: [] }),
    }));
  });

  it("selects type first, retries with the same UUID, and cancel never mutates", async () => {
    mutateAsync
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ orderId: "order-1", deliveryId: "delivery-1" });

    const onCancel = vi.fn();
    const onSuccess = vi.fn();
    render(
      <AdditionalOrderDialog
        delivery={delivery}
        open
        onCancel={onCancel}
        onSuccess={onSuccess}
      />,
    );

    expect(screen.queryByTestId("input-additional-order-item-quantity-0")).toBeNull();
    fireEvent.change(screen.getByTestId("select-additional-order-delivery-type"), {
      target: { value: delivery.deliveryType },
    });
    fireEvent.click(screen.getByTestId("button-continue-additional-order"));
    expect(
      screen.getByTestId("input-additional-order-item-quantity-0"),
    ).not.toBeNull();

    fireEvent.click(screen.getByTestId("button-add-additional-order-item"));
    fireEvent.click(screen.getByTestId("button-save-additional-order"));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Заполните все позиции заказа",
    }));
    fireEvent.click(screen.getByTestId("button-remove-additional-order-item-1"));

    fireEvent.click(screen.getByTestId("button-save-additional-order"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("button-save-additional-order"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));

    const firstRequest = mutateAsync.mock.calls[0][0];
    const secondRequest = mutateAsync.mock.calls[1][0];
    expect(firstRequest.data.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(secondRequest.data.requestId).toBe(firstRequest.data.requestId);
    expect(onSuccess).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("button-cancel-additional-order"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledTimes(2);
  });
});