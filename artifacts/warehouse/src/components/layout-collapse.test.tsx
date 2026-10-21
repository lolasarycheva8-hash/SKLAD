import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn(), session: null }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useCreateImpersonationReturnUrl: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    isAdmin: true,
    isDriver: false,
    canView: () => true,
    user: { email: "admin@example.com", assignedSiteIds: [] },
  }),
}));

import { Layout } from "@/components/layout";

const STORAGE_KEY = "lexitd.sidebar-collapsed";

describe("сворачивание левого меню", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("оставляет только иконки с подписями для навигации и запоминает выбор", () => {
    const view = render(<Layout><div>Таблица</div></Layout>);
    const sidebar = screen.getByTestId("sidebar-desktop");
    expect(sidebar.textContent).toContain("График доставок");

    fireEvent.click(screen.getByTestId("button-toggle-sidebar"));
    expect(sidebar.getAttribute("data-collapsed")).toBe("true");
    expect(sidebar.textContent).not.toContain("График доставок");
    const deliveries = sidebar.querySelector('[data-testid="link-nav-deliveries"]');
    expect(deliveries?.getAttribute("aria-label")).toBe("График доставок");
    expect(deliveries?.getAttribute("title")).toBe("График доставок");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");

    view.unmount();
    render(<Layout><div>Таблица</div></Layout>);
    expect(screen.getByTestId("sidebar-desktop").getAttribute("data-collapsed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Развернуть меню" }));
    expect(screen.getByTestId("sidebar-desktop").textContent).toContain("График доставок");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("false");
  });

  it("работает, если браузер запрещает сохранение настроек", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<Layout><div>Таблица</div></Layout>);
    fireEvent.click(screen.getByTestId("button-toggle-sidebar"));
    expect(screen.getByTestId("sidebar-desktop").getAttribute("data-collapsed")).toBe("true");
    vi.restoreAllMocks();
  });
});
