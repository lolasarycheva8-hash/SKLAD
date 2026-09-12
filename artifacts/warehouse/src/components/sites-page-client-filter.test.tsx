import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setLocation: vi.fn(),
  createSite: vi.fn(),
  createTradeName: vi.fn(),
  isAdmin: false,
  role: "manager",
  canEditSites: false,
  search: "?clientId=client-1&clientName=%D0%9F%D0%B5%D1%80%D0%B2%D1%8B%D0%B9%20%D0%BA%D0%BB%D0%B8%D0%B5%D0%BD%D1%82",
}));

vi.mock("@workspace/api-client-react", () => {
  const mutation = () => ({
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  });
  return {
    getGetLegacyDriverAssignmentsQueryKey: () => ["legacy-drivers"],
    getListSiteChangeRequestsQueryKey: () => ["site-change-requests"],
    getListSitesQueryKey: () => ["sites"],
    getListSiteBranchLookupQueryKey: () => ["site-branch-lookup"],
    getListTradeNamesQueryKey: () => ["trade-names"],
    useApproveSiteChangeRequest: mutation,
    useCreateSite: () => ({
      isPending: false,
      mutate: mocks.createSite,
    }),
    useCreateSitesBulk: mutation,
    useCreateTradeName: () => ({
      isPending: false,
      mutate: vi.fn(),
      mutateAsync: mocks.createTradeName,
    }),
    useDeleteSite: mutation,
    useDeleteTradeName: mutation,
    useGetLegacyDriverAssignments: () => ({ data: [] }),
    useListDeliveryTypes: () => ({ data: [] }),
    useListDrivers: () => ({ data: [], refetch: vi.fn() }),
    useListOrderClientLookup: () => ({
      data: [{ id: "client-1", name: "Первый клиент" }],
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    }),
    useListSiteBranchLookup: () => ({
      data: [{ name: "Северный куст" }, { name: "Южный куст" }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useListSiteChangeRequests: () => ({ data: [] }),
    useListSites: () => ({
      data: [
        site("linked-open", "Связанный открытый", "Первый клиент", "client-1"),
        site("other", "Чужой объект", "Второй клиент", "client-2"),
        site(
          "legacy-closed",
          "Старый закрытый",
          "\u00A0ПЕРВЫЙ\tКЛИЕНТ\u3000",
          null,
          true,
        ),
        site(
          "linked-closed",
          "Связанный закрытый",
          "Первый клиент",
          "client-1",
          true,
        ),
      ],
      isLoading: false,
    }),
    useListTradeNames: () => ({
      data: [{ id: "trade-name-1", name: "Магазин у дома" }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useRejectSiteChangeRequest: mutation,
    useReopenSite: mutation,
    useUpdateSite: mutation,
  };
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/sites", mocks.setLocation],
  useSearch: () => mocks.search,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    canEdit: (section: string) => mocks.isAdmin || (section === "sites" && mocks.canEditSites),
    isAdmin: mocks.isAdmin,
    user: { role: mocks.role },
  }),
}));

vi.mock("@/components/close-site-dialog", () => ({
  CloseSiteDialog: () => null,
}));

vi.mock("@/components/legacy-driver-mapping-dialog", () => ({
  LegacyDriverMappingDialog: () => null,
}));

import Sites from "@/pages/sites";

Object.assign(HTMLElement.prototype, {
  hasPointerCapture: () => false,
  setPointerCapture: () => {},
  releasePointerCapture: () => {},
  scrollIntoView: () => {},
});

function site(
  id: string,
  name: string,
  client: string,
  clientId: string | null,
  isClosed = false,
) {
  return {
    id,
    name,
    address: "Тестовый адрес",
    branch: "Тестовый куст",
    customer: "",
    client,
    clientId,
    manager: "Менеджер",
    managerContact: "",
    director: "Руководитель",
    project: "Проект",
    driverUserId: null,
    driver: "Не назначен",
    deliveryType: "",
    closedFrom: isClosed ? "2026-09-01" : null,
    reopenDate: null,
    closureReason: isClosed ? "Тест" : null,
    closedBy: null,
    isClosed,
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

async function selectOption(
  testId: string,
  option: string,
) {
  fireEvent.keyDown(screen.getByTestId(testId), {
    key: "ArrowDown",
    code: "ArrowDown",
  });
  const optionNode = screen.getByRole("option", { name: option });
  fireEvent.keyDown(optionNode, { key: "Enter", code: "Enter" });
}

function fillRequiredSiteFields() {
  fireEvent.change(screen.getByTestId("input-site-name"), {
    target: { value: "Новый объект" },
  });
  fireEvent.change(screen.getByTestId("input-site-address"), {
    target: { value: "Новый адрес" },
  });
  fireEvent.change(screen.getByTestId("input-site-director"), {
    target: { value: "Новый руководитель" },
  });
  fireEvent.change(screen.getByTestId("input-site-project"), {
    target: { value: "Новый проект" },
  });
}

beforeEach(() => {
  mocks.createTradeName.mockReset();
  mocks.createTradeName.mockImplementation(
    async ({ data }: { data: { name: string } }) => ({
      id: "trade-name-created",
      name: data.name,
    }),
  );
});

afterEach(() => {
  cleanup();
  mocks.isAdmin = false;
  mocks.role = "manager";
  mocks.canEditSites = false;
  mocks.search = "?clientId=client-1&clientName=%D0%9F%D0%B5%D1%80%D0%B2%D1%8B%D0%B9%20%D0%BA%D0%BB%D0%B8%D0%B5%D0%BD%D1%82";
  mocks.setLocation.mockClear();
});

it("показывает по ссылке только связанные, закрытые и legacy-объекты клиента", async () => {
  render(<Sites />);

  expect(
    (await screen.findByTestId("filter-sites-client")).textContent,
  ).toContain("Клиент: Первый клиент");
  await waitFor(() => {
    expect(screen.getByTestId("row-site-linked-open")).toBeTruthy();
    expect(screen.getByTestId("row-site-linked-closed")).toBeTruthy();
    expect(screen.getByTestId("row-site-legacy-closed")).toBeTruthy();
  });
  expect(screen.queryByTestId("row-site-other")).toBeNull();
  expect(screen.getByTestId("text-sites-count").textContent).toContain("3");
});

it("не показывает администратору ручную привязку клиентов", () => {
  mocks.isAdmin = true;

  render(<Sites />);

  expect(
    screen.queryByTestId("button-open-site-client-mapping"),
  ).toBeNull();
  expect(screen.queryByText(/Привязка клиентов/)).toBeNull();
});

it("логист с доступом к объектам открывает общую форму, но не получает импорт и удаление", () => {
  mocks.role = "logistician";
  mocks.canEditSites = true;
  render(<Sites />);

  fireEvent.click(screen.getByTestId("button-add-site"));
  expect(screen.getByRole("dialog").textContent).toContain("Новый объект");
  expect(screen.getByTestId("input-site-name")).toBeTruthy();
  expect(screen.getByTestId("select-site-client")).toBeTruthy();
  expect(screen.getByTestId("button-submit-site")).toBeTruthy();
  expect(screen.queryByTestId("button-import-sites")).toBeNull();
  expect(screen.queryByTestId("button-delete-site-linked-open")).toBeNull();
});

it("логист может открыть добавление объекта по прямой ссылке", async () => {
  mocks.role = "logistician";
  mocks.canEditSites = true;
  mocks.search = "?add=1";
  render(<Sites />);

  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(mocks.setLocation).toHaveBeenCalledWith("/sites");
});

it.each(["manager", "logistician", "driver"])(
  "роль %s без права редактировать объекты не получает добавление даже по ссылке",
  (role) => {
    mocks.role = role;
    mocks.search = "?add=1";
    render(<Sites />);
    expect(screen.queryByTestId("button-add-site")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.setLocation).not.toHaveBeenCalled();
  },
);


it("администратор сохраняет доступ к добавлению объекта", () => {
  mocks.isAdmin = true;
  mocks.role = "admin";
  render(<Sites />);
  fireEvent.click(screen.getByTestId("button-add-site"));
  expect(screen.getByRole("dialog").textContent).toContain("Новый объект");
});

it.each(["admin", "logistician"] as const)(
  "%s может выбрать существующий куст и торговое название при добавлении объекта",
  async (role) => {
    const user = userEvent.setup();
    mocks.isAdmin = role === "admin";
    mocks.role = role;
    mocks.canEditSites = role === "logistician";
    render(<Sites />);

    await user.click(screen.getByTestId("button-add-site"));
    await selectOption("select-site-branch", "Северный куст");
    expect(screen.getByTestId("select-site-branch").textContent).toContain(
      "Северный куст",
    );
    await selectOption("select-site-customer", "Магазин у дома");
    expect(screen.getByTestId("select-site-customer").textContent).toContain(
      "Магазин у дома",
    );
  },
);

it.each(["admin", "logistician"] as const)(
  "%s может создать и выбрать новый куст и торговое название",
  async (role) => {
    const user = userEvent.setup();
    mocks.isAdmin = role === "admin";
    mocks.role = role;
    mocks.canEditSites = role === "logistician";
    render(<Sites />);

    await user.click(screen.getByTestId("button-add-site"));
    await selectOption("select-site-branch", "Создать новый");
    fireEvent.change(screen.getByTestId("input-new-site-branch"), { target: { value: "  Новый куст  " } });
    fireEvent.click(screen.getByTestId("button-create-site-branch"));
    expect(screen.getByTestId("select-site-branch").textContent).toContain(
      "Новый куст",
    );

    await selectOption("select-site-customer", "Создать новый");
    fireEvent.change(screen.getByTestId("input-new-site-customer"), { target: { value: "  Новое название  " } });
    fireEvent.click(screen.getByTestId("button-create-site-customer"));
    await waitFor(() =>
      expect(mocks.createTradeName).toHaveBeenCalledWith({
        data: { name: "Новое название" },
      }),
    );
    expect(screen.getByTestId("select-site-customer").textContent).toContain(
      "Новое название",
    );
  },
);

it("при создании отправляет обрезанные значения куста и торгового названия", async () => {
  const user = userEvent.setup();
  mocks.isAdmin = true;
  mocks.role = "admin";
  mocks.createTradeName.mockResolvedValue({
    id: "trade-name-created",
    name: "Название из API",
  });
  render(<Sites />);

  await user.click(screen.getByTestId("button-add-site"));
  fillRequiredSiteFields();
  await selectOption("select-site-client", "Первый клиент");
  await selectOption("select-site-branch", "Создать новый");
  fireEvent.change(screen.getByTestId("input-new-site-branch"), { target: { value: "  Новый куст  " } });
  fireEvent.click(screen.getByTestId("button-create-site-branch"));
  await selectOption("select-site-customer", "Создать новый");
  fireEvent.change(screen.getByTestId("input-new-site-customer"), { target: { value: "  Черновое название  " } });
  fireEvent.click(screen.getByTestId("button-create-site-customer"));
  await waitFor(() =>
    expect(screen.getByTestId("select-site-customer").textContent).toContain(
      "Название из API",
    ),
  );

  fireEvent.submit(screen.getByTestId("button-submit-site").closest("form")!);
  expect(mocks.createSite).toHaveBeenCalledWith({
    data: expect.objectContaining({
      branch: "Новый куст",
      customer: "Название из API",
    }),
  });
});

it.each(["branch", "customer"] as const)(
  "не отправляет форму с пустым или состоящим из пробелов полем %s",
  async (requiredLookup) => {
    const user = userEvent.setup();
    mocks.isAdmin = true;
    mocks.role = "admin";
    render(<Sites />);

    await user.click(screen.getByTestId("button-add-site"));
    fillRequiredSiteFields();
    await selectOption("select-site-client", "Первый клиент");
    if (requiredLookup === "branch") {
      await selectOption("select-site-customer", "Магазин у дома");
    } else {
      await selectOption("select-site-branch", "Северный куст");
    }

    const form = screen.getByTestId("button-submit-site").closest("form")!;
    fireEvent.submit(form);
    expect(mocks.createSite).not.toHaveBeenCalled();

    await selectOption(
      `select-site-${requiredLookup}`,
      "Создать новый",
    );
    fireEvent.change(screen.getByTestId(`input-new-site-${requiredLookup}`), { target: { value: "   " } });
    fireEvent.submit(form);
    expect(mocks.createSite).not.toHaveBeenCalled();
  },
);