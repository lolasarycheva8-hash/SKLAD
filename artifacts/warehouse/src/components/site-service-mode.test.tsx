import { describe, expect, it } from "vitest";
import { parseServiceMode, siteServiceMode } from "./site-service-mode";

describe("формат обслуживания объекта", () => {
  it("сохраняет смысл старого доп.заказа без изменения типа", () => {
    expect(siteServiceMode({ deliveryType: "доп.заказ" })).toBe("additional_only");
    expect(siteServiceMode({ deliveryType: "коробочка" })).toBe("monthly");
    expect(siteServiceMode({ serviceMode: "monthly", deliveryType: "доп.заказ" })).toBe("monthly");
  });
  it("читает оба формата из Excel, сохраняет отсутствие поля и отвергает неизвестный текст", () => {
    expect(parseServiceMode("Ежемесячная поставка")).toBe("monthly");
    expect(parseServiceMode(" Доставка доп.заказов ")).toBe("additional_only");
    expect(parseServiceMode("")).toBeUndefined();
    expect(() => parseServiceMode("коробочка")).toThrow("Неизвестный формат");
  });
});
