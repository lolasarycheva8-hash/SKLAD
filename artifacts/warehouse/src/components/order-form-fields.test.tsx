import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_ORDER_FORM_ITEM,
  OrderFormFields,
} from "@/components/order-form-fields";

describe("shared order form fields", () => {
  it("keeps the regular order product row contract", () => {
    const onItemChange = vi.fn();

    render(
      <OrderFormFields
        clients={[{ id: "client-1", name: "Клиент" }]}
        products={[
          { id: "product-1", name: "Плита", unit: "шт", price: 120 },
        ]}
        clientId="client-1"
        onClientChange={vi.fn()}
        items={[{ ...EMPTY_ORDER_FORM_ITEM }]}
        onItemChange={onItemChange}
        onProductSelect={vi.fn()}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
        note=""
        onNoteChange={vi.fn()}
      />,
    );

    const quantity = screen.getByTestId("input-order-item-quantity-0");
    fireEvent.change(quantity, { target: { value: "3" } });

    expect(screen.getByTestId("select-order-item-product-0")).not.toBeNull();
    expect(onItemChange).toHaveBeenCalledWith(0, { quantity: "3" });
  });
});