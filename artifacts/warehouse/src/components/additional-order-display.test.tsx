import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AdditionalOrderItems,
  AdditionalOrderLabel,
} from "@/components/additional-order-display";

describe("additional delivery display", () => {
  afterEach(cleanup);

  it("marks only the additional delivery and links its order when allowed", () => {
    render(
      <>
        <AdditionalOrderLabel delivery={{ hasAdditionalOrders: true }} />
        <AdditionalOrderLabel delivery={{}} />
        <AdditionalOrderLabel
          delivery={{ orderId: "child-order", hasAdditionalOrders: false }}
          canViewOrders
        />
      </>,
    );

    expect(screen.getAllByText("ДОП.ЗАКАЗ")).toHaveLength(1);
    expect(
      screen.getByTestId("link-additional-order").getAttribute("href"),
    ).toBe("/orders/child-order");
  });

  it("marks the driver's additional delivery without granting an order link", () => {
    render(
      <>
        <AdditionalOrderLabel delivery={{ hasAdditionalOrders: true }} />
        <AdditionalOrderLabel
          delivery={{ parentDeliveryId: "parent", orderId: "child-order" }}
        />
      </>,
    );
    expect(screen.getAllByText("ДОП.ЗАКАЗ")).toHaveLength(1);
    expect(screen.queryByTestId("link-additional-order")).toBeNull();
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