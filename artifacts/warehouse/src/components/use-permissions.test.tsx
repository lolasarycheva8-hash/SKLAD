import { describe, expect, it } from "vitest";

import { isDriverUser } from "@/hooks/use-permissions";

describe("isDriverUser", () => {
  it("считает водителем пользователя с ролью driver", () => {
    expect(isDriverUser({ role: "driver", isDriver: false })).toBe(true);
  });

  it("считает водителем старую учётную запись с флагом isDriver", () => {
    expect(isDriverUser({ role: "manager", isDriver: true })).toBe(true);
  });

  it("не даёт обычному пользователю водительский интерфейс", () => {
    expect(isDriverUser({ role: "manager", isDriver: false })).toBe(false);
  });
});