import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AdditionalOrderItems,
  AdditionalOrderLabel,
} from "@/components/additional-order-display";

describe("additional delivery display", () => {
  it("marks a parent delivery and links a child order only when allowed", () => {
    render(
      <>
        <AdditionalOrderLabel delivery={{ hasAdditionalOrders: true }} />
        <AdditionalOrderLabel
          delivery={{ orderId: "child-order", hasAdditionalOrders: false }}
          canViewOrders
        />
      </>,
    );

    expect(screen.getAllByText("ДОП.ЗАКАЗ")).toHaveLength(2);
    expect(
      screen.getByTestId("link-additional-order").getAttribute("href"),
    ).toBe("/orders/child-order");
  });

  it("shows child products without exposing prices", () => {
    render(
      <AdditionalOrderItems
        items={[
          {
            productId: "product-1",
            productName: "Плита",
            quantity: 2,
            unit: "шт",
          },
        ]}
      />,
    );

    expect(screen.getByText(/Плита — 2 шт/)).not.toBeNull();
    expect(screen.queryByText(/Цена|₽|руб/)).toBeNull();
  });
});