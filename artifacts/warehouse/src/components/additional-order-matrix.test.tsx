import { describe, expect, it } from "vitest";
import {
  buildAdditionalOrderMatrixRows,
  type AdditionalOrderMatrixDelivery,
} from "@/lib/additional-order-matrix";

type TestDelivery = AdditionalOrderMatrixDelivery & {
  plannedDate: string | null;
  deliveryType: string;
  additionalOrderItems: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unit: string;
  }>;
};

function delivery(overrides: Partial<TestDelivery>): TestDelivery {
  return {
    id: "delivery",
    siteId: "site-1",
    siteName: "Объект",
    siteClient: "Клиент",
    driver: "Водитель",
    parentDeliveryId: null,
    orderId: null,
    hasAdditionalOrders: false,
    additionalOrderItems: [],
    plannedDate: "2026-01-01",
    deliveryType: "Коробка",
    ...overrides,
  };
}

describe("schedule additional-order aggregation", () => {
  it("keeps every child order instead of retaining an arbitrary parent row", () => {
    const rows = buildAdditionalOrderMatrixRows([
      delivery({ id: "parent", hasAdditionalOrders: true }),
      delivery({
        id: "child-1",
        parentDeliveryId: "parent",
        orderId: "order-1",
        deliveryType: "Палета",
        plannedDate: "2026-01-03",
        additionalOrderItems: [
          {
            productId: "product-1",
            productName: "Плита",
            quantity: 2,
            unit: "шт",
          },
        ],
      }),
      delivery({
        id: "child-2",
        parentDeliveryId: "parent",
        orderId: "order-2",
        deliveryType: "Коробка",
        plannedDate: "2026-01-05",
        additionalOrderItems: [
          {
            productId: "product-2",
            productName: "Кабель",
            quantity: 4,
            unit: "м",
          },
        ],
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].additionalOrderDeliveries.map((item) => item.id)).toEqual([
      "child-1",
      "child-2",
    ]);
    expect(
      rows[0].additionalOrderDeliveries.map((item) => [
        item.plannedDate,
        item.deliveryType,
        item.additionalOrderItems?.[0]?.productName,
      ]),
    ).toEqual([
      ["2026-01-03", "Палета", "Плита"],
      ["2026-01-05", "Коробка", "Кабель"],
    ]);
  });
});