// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Site } from "@workspace/api-client-react";
import { CloseSiteDialog } from "./close-site-dialog";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  toast: vi.fn(),
  isAdmin: false,
}));

vi.mock("@workspace/api-client-react", () => ({
  useCloseSite: () => ({ mutate: mocks.mutate, isPending: false }),
  getListSitesQueryKey: () => ["sites"],
  getGetSiteQueryKey: (id: string) => ["sites", id],
  getListDeliverySiteLookupQueryKey: () => ["delivery-site-lookup"],
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({ isAdmin: mocks.isAdmin }),
}));

function submitDates(closedFrom: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CloseSiteDialog
        site={{ id: "test-site", name: "Объект" } as Site}
        open
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("Дата снятия с обслуживания*"), {
    target: { value: closedFrom },
  });
  fireEvent.submit(screen.getByTestId("button-submit-site-closure").closest("form")!);
}

describe("даты закрытия объекта независимо от часового пояса", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdmin = false;
  });
  afterEach(cleanup);

  it.each([false, true])("принимает даты со скриншота, администратор: %s", (isAdmin) => {
    mocks.isAdmin = isAdmin;
    submitDates("2026-09-29");
    expect(mocks.mutate).toHaveBeenCalledWith({
      id: "test-site",
      data: { closedFrom: "2026-09-29", reason: null },
    });
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("убирает планируемую дату открытия и объясняет сохранность доставок", () => {
    submitDates("2026-09-29");
    expect(mocks.mutate).toHaveBeenCalledWith({
      id: "test-site",
      data: { closedFrom: "2026-09-29", reason: null },
    });
    expect(screen.queryByLabelText("Планируемая дата открытия")).toBeNull();
    expect(screen.getByText(/Доставки и акты сохранятся/)).toBeTruthy();
  });

  it("отклоняет пустую дату закрытия", () => {
    submitDates("");
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      description: "Укажите действительную дату снятия с обслуживания.",
    }));
  });
});