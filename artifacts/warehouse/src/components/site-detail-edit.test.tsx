import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "logistician",
  hasSites: true,
  pending: false,
  save: vi.fn(),
  propose: vi.fn(),
  invalidate: vi.fn(),
  toast: vi.fn(),
  callbacks: {} as { onSuccess?: () => void; onError?: (error: Error) => void },
  site: {
    id: "site-test", name: "Объект", address: "Адрес", branch: "Куст",
    customer: "", client: "Клиент", clientId: "client-test",
    manager: "Менеджер", managerContact: "+7 (999) 000-00-00",
    director: "Руководитель", project: "Проект",
    driverUserId: "driver-test", deliveryType: "", features: "Вход со двора",
    isClosed: false,
  },
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: state.site.id }),
  useLocation: () => ["/sites/site-test", vi.fn()],
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    isAdmin: state.role === "admin",
    canEdit: () => state.role === "admin" || (state.role === "logistician" && state.hasSites),
  }),
}));
vi.mock("@/components/close-site-dialog", () => ({ CloseSiteDialog: () => null }));
vi.mock("@workspace/api-client-react", () => ({
  useGetSite: () => ({ data: state.site, isLoading: false }),
  useUpdateSite: ({ mutation }: { mutation: typeof state.callbacks }) => {
    state.callbacks = mutation;
    return { mutate: state.save, isPending: state.pending };
  },
  useCreateSiteChangeRequest: () => ({ mutate: state.propose, isPending: false }),
  useUpdateSiteFeatures: () => ({ mutate: vi.fn(), isPending: false }),
  useReopenSite: () => ({ mutate: vi.fn(), isPending: false }),
  useListTradeNames: () => ({ data: [] }),
  useListDeliveryTypes: () => ({ data: [] }),
  useListDrivers: () => ({ data: [{ id: "driver-test", name: "Водитель" }] }),
  useListOrderClientLookup: () => ({ data: [{ id: "client-test", name: "Клиент" }] }),
  getListSitesQueryKey: () => ["sites"],
  getGetSiteQueryKey: (id: string) => ["site", id],
  getListDeliverySiteLookupQueryKey: () => ["delivery-site-lookup"],
}));

import SiteDetail from "@/pages/site-detail";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.role = "logistician";
  state.hasSites = true;
  state.pending = false;
});

it.each(["logistician", "admin"])("%s сохраняет карточку напрямую без согласования", (role) => {
  state.role = role;
  render(<SiteDetail />);
  expect(screen.queryByText("Отправить на согласование")).toBeNull();
  expect((screen.getByTestId("select-site-client") as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByTestId("select-site-driver") as HTMLButtonElement).disabled).toBe(false);
  fireEvent.change(screen.getByTestId("input-site-name"), { target: { value: "Новое название" } });
  fireEvent.change(screen.getByTestId("input-site-manager-contact"), { target: { value: "+7 (999) 111-11-11" } });
  fireEvent.change(screen.getByTestId("textarea-site-features"), { target: { value: "Новый вход" } });
  fireEvent.click(screen.getByTestId("button-submit-site"));
  expect(state.save).toHaveBeenCalledWith({
    id: "site-test",
    data: {
      name: "Новое название", address: "Адрес", branch: "Куст", customer: "",
      clientId: "client-test", manager: "Менеджер", managerContact: "+7 (999) 111-11-11",
      director: "Руководитель", project: "Проект", driverUserId: "driver-test",
      deliveryType: "", features: "Новый вход",
    },
  });
  expect(state.propose).not.toHaveBeenCalled();
  act(() => state.callbacks.onSuccess?.());
  expect(state.toast).toHaveBeenCalledWith({ title: "Объект обновлён" });
  expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ["site", "site-test"] });
  expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ["sites"] });
  expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ["delivery-site-lookup"] });
  if (role === "logistician") expect(screen.queryByText("Закрыть объект")).toBeNull();
});

it.each(["manager", "driver", "logistician"])("%s без права редактировать не может сохранить карточку", (role) => {
  state.role = role;
  state.hasSites = false;
  render(<SiteDetail />);
  const name = screen.getByTestId("input-site-name") as HTMLInputElement;
  expect(name.disabled).toBe(true);
  expect(screen.queryByTestId("button-submit-site")).toBeNull();
  fireEvent.submit(name.closest("form")!);
  expect(state.save).not.toHaveBeenCalled();
});

it("сохраняет черновик при ошибке и блокирует повторную отправку во время сохранения", () => {
  const { rerender } = render(<SiteDetail />);
  const name = screen.getByTestId("input-site-name") as HTMLInputElement;
  fireEvent.change(name, { target: { value: "Черновик" } });
  fireEvent.click(screen.getByTestId("button-submit-site"));
  act(() => state.callbacks.onError?.(new Error("Не удалось сохранить")));
  expect(name.value).toBe("Черновик");
  expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  state.pending = true;
  rerender(<SiteDetail />);
  expect((screen.getByTestId("button-submit-site") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(name.closest("form")!);
  expect(state.save).toHaveBeenCalledTimes(1);
});