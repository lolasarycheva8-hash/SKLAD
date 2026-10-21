import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import { AdditionalOrderLabel } from "./additional-order-display";

describe("метки стандартных доставок", () => {
  afterEach(cleanup);
  it.each(["оборудование", "Поломоечная машина", "коробочка"])("показывает выбранный тип %s на метке доп.доставки", (deliveryType) => {
    render(<AdditionalOrderLabel delivery={{ deliveryType, parentDeliveryId: "source" }} />);
    expect(screen.getByTestId("badge-additional-order").textContent).toBe(deliveryType.toLocaleUpperCase("ru"));
  });
  it("сохраняет общую метку, если тип старой доп.доставки не указан", () => {
    render(<AdditionalOrderLabel delivery={{ orderId: "order" }} />);
    expect(screen.getByTestId("badge-additional-order").textContent).toBe("ДОП.ЗАКАЗ");
  });
  it.each([["закрытие", "ВЫВОЗ"], ["открывашка", "ОТКРЫВАШКА"], ["отмывка", "ОТМЫВКА"]])("%s отображается как %s", (deliveryType, label) => {
    render(<AdditionalOrderLabel delivery={{ deliveryType, orderId: "order" }} />);
    expect(screen.getByTestId("badge-additional-order").textContent).toBe(label);
  });
  it("обычный доп.заказ сохраняет свою метку", () => {
    render(<AdditionalOrderLabel delivery={{ deliveryType: "доп.заказ", orderId: "order" }} />);
    expect(screen.getByTestId("badge-additional-order").textContent).toBe("ДОП.ЗАКАЗ");
  });
});
