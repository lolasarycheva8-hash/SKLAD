import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PermissionsProvider, isLogisticianRole, usePermissions } from "@/hooks/use-permissions";

const permissionUser = vi.hoisted(() => ({
  role: "logistician",
  editableSections: [] as string[],
  isDriver: false,
}));
vi.mock("@workspace/api-client-react", () => ({
  useGetCurrentUser: () => ({ data: permissionUser, isLoading: false }),
  getGetCurrentUserQueryKey: () => ["current-user"],
}));
afterEach(cleanup);

function PermissionProbe() {
  const permissions = usePermissions();
  return <pre data-testid="permissions">{JSON.stringify({
    productsView: permissions.canView("products"),
    productsEdit: permissions.canEdit("products"),
    ordersView: permissions.canView("orders"),
    ordersEdit: permissions.canEdit("orders"),
    sitesEdit: permissions.canEdit("sites"),
    isAdmin: permissions.isAdmin,
  })}</pre>;
}

it.each(["logistician", "manager", "driver"])(
  "роль %s получает только положенные ей права по умолчанию",
  (role) => {
    permissionUser.role = role;
    permissionUser.editableSections = [];
    render(<PermissionsProvider><PermissionProbe /></PermissionsProvider>);
    const allowed = isLogisticianRole(role as "logistician" | "manager" | "driver");
    expect(JSON.parse(screen.getByTestId("permissions").textContent!)).toEqual({
      productsView: allowed,
      productsEdit: allowed,
      ordersView: allowed,
      ordersEdit: allowed,
      sitesEdit: false,
      isAdmin: false,
    });
  },
);

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