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
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({ isAdmin: mocks.isAdmin }),
}));

function submitDates(closedFrom: string, reopenDate = "") {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CloseSiteDialog
        site={{ id: "test-site", name: "Объект" } as Site}
        open
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("Дата закрытия (с)*"), {
    target: { value: closedFrom },
  });
  fireEvent.change(screen.getByLabelText("Планируемая дата открытия"), {
    target: { value: reopenDate },
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
    submitDates("2026-09-29", "2026-09-30");
    expect(mocks.mutate).toHaveBeenCalledWith({
      id: "test-site",
      data: { closedFrom: "2026-09-29", reopenDate: "2026-09-30", reason: null },
    });
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("принимает закрытие без даты открытия", () => {
    submitDates("2026-09-29");
    expect(mocks.mutate).toHaveBeenCalledWith({
      id: "test-site",
      data: { closedFrom: "2026-09-29", reopenDate: null, reason: null },
    });
  });

  it.each(["2026-09-28", "2026-09-29"])("отклоняет открытие %s не позже закрытия", (date) => {
    submitDates("2026-09-29", date);
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Некорректная дата" }));
  });

  it("отклоняет пустую дату закрытия", () => {
    submitDates("");
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      description: "Укажите действительную дату закрытия.",
    }));
  });
});