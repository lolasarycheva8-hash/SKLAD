import "./select-jsdom-compat";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

const createBulkRequest = vi.fn();
const { exportDriverProgressSpy } = vi.hoisted(() => ({ exportDriverProgressSpy: vi.fn() }));
vi.mock("@/lib/driver-progress-export", () => ({ exportDriverProgress: exportDriverProgressSpy }));
const createDeliveryRequest = vi.fn();
const replaceBulkRequest = vi.fn();
const noopMutation = { isPending: false, mutate: vi.fn() };
const { updateActualBulkRequest, deliveryTestState, downloadFileResponse, toast, refetchDeliveries, refetchSites, downloadTemplateSpy, listDeliveriesQuery, exportRowsToExcelSpy } = vi.hoisted(() => ({
  exportRowsToExcelSpy: vi.fn(),
  listDeliveriesQuery: vi.fn(),
  downloadTemplateSpy: vi.fn(),
  updateActualBulkRequest: vi.fn(),
  downloadFileResponse: vi.fn(),
  toast: vi.fn(),
  refetchDeliveries: vi.fn(),
  refetchSites: vi.fn(),
  deliveryTestState: {
    deliveries: [] as Record<string, unknown>[],
    adminAccess: false,
    role: "logistician" as "logistician" | "manager",
    canApproveActs: false,
    deliveriesError: false,
    deliveriesStaleError: false,
    sitesError: false,
    deliveriesLoading: false,
    sitesLoading: false,
    deliveriesFetching: false,
    sitesFetching: false,
    driversLoading: false,
    driversError: false,
    emptyDrivers: false,
    pendingMonth: null as string | null,
  },
}));

vi.mock("@/lib/excel-import", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/excel-import")>(),
  downloadTemplate: downloadTemplateSpy,
  exportRowsToExcel: exportRowsToExcelSpy,
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetDeliveryDashboardSummaryQueryKey: () => ["delivery-dashboard"],
  getGetDashboardSummaryQueryKey: () => ["dashboard-summary"],
  getListDeliveriesQueryKey: (params?: unknown) => ["deliveries", ...(params ? [params] : [])],
  getListDeliverySiteLookupQueryKey: () => ["delivery-site-lookup"],
  getListMyDeliveriesQueryKey: () => ["my-deliveries"],
  getListDriversQueryKey: () => ["drivers"],
  useApproveDeliveryAct: () => noopMutation,
  useCreateDelivery: () => ({
    isPending: false,
    mutate: createDeliveryRequest,
  }),
  useCreateDeliveriesBulk: () => ({
    isPending: false,
    mutate: createBulkRequest,
  }),
  useDeleteDelivery: () => noopMutation,
  useRestoreDelivery: () => noopMutation,
  useListDeliveries: (params: { month: string; archived: boolean }) => {
    const { month, archived } = params;
    listDeliveriesQuery(params);
    return {
      data:
        !archived &&
        (deliveryTestState.deliveriesLoading ||
          deliveryTestState.deliveriesError ||
          deliveryTestState.pendingMonth === month)
          ? undefined
          : deliveryTestState.deliveries,
      isLoading:
        !archived &&
        (deliveryTestState.deliveriesLoading ||
          deliveryTestState.pendingMonth === month),
      isFetching:
        !archived &&
        (deliveryTestState.deliveriesFetching ||
          deliveryTestState.pendingMonth === month),
      isError:
        deliveryTestState.deliveriesError ||
        deliveryTestState.deliveriesStaleError,
      refetch: refetchDeliveries,
    };
  },
  useListDeliverySiteLookup: () => ({
    data:
      deliveryTestState.sitesLoading || deliveryTestState.sitesError
        ? undefined
        : [
      {
        id: "site-alpha",
        name: "Объект Альфа",
        address: "Адрес Альфа",
        branch: "Куст Альфа",
        manager: "Менеджер Альфа",
        managerContact: "+7 (999) 123-45-67",
        deliveryType: "Коробка",
        features: "Вход со двора",
        driverUserId: "driver-1",
        driver: "Иван Водитель",
        client: "",
        isClosed: false,
      },
      {
        id: "site-beta",
        name: "Объект Бета",
        address: "Адрес Бета",
        branch: "",
        manager: "",
        deliveryType: "",
        driverUserId: "driver-1",
        driver: "Иван Водитель",
        client: "",
        isClosed: false,
      },
    ],
    isLoading: deliveryTestState.sitesLoading,
    isFetching: deliveryTestState.sitesFetching,
    isError: deliveryTestState.sitesError,
    refetch: refetchSites,
  }),
  useListDrivers: () => ({
    data: deliveryTestState.emptyDrivers ? [] : [
      {
        id: "driver-1",
        name: "Иван Водитель",
        email: "driver@example.test",
      },
    ],
    isLoading: deliveryTestState.driversLoading,
    isError: deliveryTestState.driversError,
  }),
  getListDeliveryTypeLookupQueryKey: () => ["delivery-type-lookup"],
  useListDeliveryTypeLookup: () => ({
    data: [{ id: "type-box", name: "Коробка" }, { id: "type-pallet", name: "Палета" }],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useReplaceDeliveriesBulk: () => ({
    isPending: false,
    mutate: replaceBulkRequest,
  }),
  useUpdateDeliveriesBulk: () => noopMutation,
  useRescheduleDelivery: () => noopMutation,
  useUpdateDelivery: () => noopMutation,
  updateDeliveriesActualBulk: updateActualBulkRequest,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...original,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("@/hooks/use-permissions", () => ({
  isLogisticianRole: (role: string) => role === "logistician" || role === "manager",
  usePermissions: () => ({
    user: { id: "editor-1", role: deliveryTestState.adminAccess ? "admin" : deliveryTestState.role },
    canEdit: () => true,
    isAdmin: deliveryTestState.adminAccess,
    canApproveDeliveryActs: deliveryTestState.canApproveActs,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("@/lib/download-file", () => ({
  downloadFileResponse,
}));

vi.mock("@/components/delivery-photos-dialog", () => ({
  DeliveryPhotosDialog: () => null,
}));

import Deliveries from "@/pages/deliveries";

afterEach(cleanup);

it.each(["deliveriesError", "sitesError"] as const)(
  "shows the main retry state when %s is true",
  (failure) => {
    deliveryTestState[failure] = true;
    render(<Deliveries />);

    expect(screen.getByTestId("deliveries-main-error")).toBeTruthy();
    expect(screen.queryByTestId("delivery-month-progress")).toBeNull();
    fireEvent.click(screen.getByTestId("tab-schedule"));
    expect(screen.getByTestId("deliveries-main-error")).toBeTruthy();
    expect(screen.queryByTestId("input-search-deliveries-schedule")).toBeNull();
    expect(screen.queryByTestId("counter-schedule-rows")).toBeNull();
    fireEvent.click(screen.getByTestId("button-retry-deliveries-main"));
    expect(refetchDeliveries).toHaveBeenCalled();
    expect(refetchSites).toHaveBeenCalled();

    deliveryTestState[failure] = false;
  },
);

it.each(["deliveriesLoading", "sitesLoading"] as const)(
  "hides empty counters and tables while %s is true",
  (pending) => {
    deliveryTestState[pending] = true;
    render(<Deliveries />);

    expect(screen.getByTestId("deliveries-main-loading")).toBeTruthy();
    expect(screen.queryByTestId("delivery-month-progress")).toBeNull();
    expect(screen.queryByTestId("counter-workspace-rows")).toBeNull();
    fireEvent.click(screen.getByTestId("tab-schedule"));
    expect(screen.getByTestId("deliveries-main-loading")).toBeTruthy();
    expect(screen.queryByTestId("counter-schedule-rows")).toBeNull();

    deliveryTestState[pending] = false;
  },
);

it("keeps cached rows mounted during a background refresh", () => {
  deliveryTestState.deliveries = [{
    id: "cached-delivery",
    siteId: "site-alpha",
    siteName: "Объект Альфа",
    driver: "Иван Водитель",
    driverUserId: "driver-1",
    plannedDate: "2026-09-15",
    actualDate: null,
    workflowStatus: "planned",
    photosCount: 0,
    lagDays: null,
  }];
  deliveryTestState.deliveriesFetching = true;

  render(<Deliveries />);

  expect(screen.getByTestId("deliveries-main-updating")).toBeTruthy();
  expect(screen.queryByTestId("deliveries-main-loading")).toBeNull();
  expect(screen.getByTestId("counter-workspace-rows").textContent).toContain("1");

  deliveryTestState.deliveriesFetching = false;
});

it("keeps cached rows usable after a background refresh error", () => {
  deliveryTestState.deliveries = [{
    id: "stale-delivery",
    siteId: "site-alpha",
    siteName: "Объект Альфа",
    driver: "Иван Водитель",
    driverUserId: "driver-1",
    plannedDate: "2026-09-15",
    actualDate: null,
    workflowStatus: "planned",
    photosCount: 0,
    lagDays: null,
  }];
  deliveryTestState.deliveriesStaleError = true;

  render(<Deliveries />);

  expect(screen.getByTestId("deliveries-main-stale-warning")).toBeTruthy();
  expect(screen.queryByTestId("deliveries-main-error")).toBeNull();
  expect(screen.getByTestId("counter-workspace-rows").textContent).toContain("1");

  deliveryTestState.deliveriesStaleError = false;
});

it("does not show previous-month rows while the selected month is pending", () => {
  deliveryTestState.deliveries = [{
    id: "september-delivery",
    siteId: "site-alpha",
    siteName: "Объект Альфа",
    driver: "Иван Водитель",
    driverUserId: "driver-1",
    plannedDate: "2026-09-15",
    actualDate: null,
    workflowStatus: "planned",
    photosCount: 0,
    lagDays: null,
  }];
  deliveryTestState.pendingMonth = "2026-10";
  window.history.replaceState({}, "", "/?month=2026-09");
  render(<Deliveries />);
  expect(screen.getByTestId("counter-workspace-rows").textContent).toContain("1");

  fireEvent.change(screen.getByTestId("input-month-selector"), {
    target: { value: "10" },
  });

  expect(screen.getByTestId("deliveries-main-loading")).toBeTruthy();
  expect(screen.queryByTestId("counter-workspace-rows")).toBeNull();
  deliveryTestState.pendingMonth = null;
});

type ImportFileFormat = "xlsx" | "xls" | "csv";

function buildRealImportFile(
  options?: {
    includeMissingSites?: boolean;
    format?: ImportFileFormat;
  },
): File {
  const format = options?.format ?? "xlsx";
  const rows = [
    {
      Объект: "Объект Альфа",
      Водитель: "Иван Водитель",
      "Email водителя": "driver@example.test",
      "Плановая дата": new Date(Date.UTC(2026, 8, 15)),
    },
    ...(options?.includeMissingSites
      ? [
          {
            Объект: "Новый объект Гамма",
            Водитель: "Иван Водитель",
            "Email водителя": "driver@example.test",
            "Плановая дата": new Date(Date.UTC(2026, 8, 16)),
          },
          {
            Объект: "Новый объект Дельта",
            Водитель: "Иван Водитель",
            "Email водителя": "driver@example.test",
            "Плановая дата": new Date(Date.UTC(2026, 8, 17)),
          },
        ]
      : []),
    {
      Объект: "Объект Бета",
      Водитель: "Иван Водитель",
      "Email водителя": "driver@example.test",
      "Плановая дата": new Date(Date.UTC(2026, 9, 2)),
    },
    {
      Объект: "Объект Альфа",
      Водитель: "Иван Водитель",
      "Email водителя": "driver@example.test",
      "Плановая дата": new Date(Date.UTC(2026, 8, 15)),
    },
  ];
  const worksheet = XLSX.utils.json_to_sheet(
    format === "csv"
      ? rows.map((row) => ({
          ...row,
          "Плановая дата": row["Плановая дата"].toISOString().slice(0, 10),
        }))
      : rows,
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "График");
  const bytes = XLSX.write(workbook, {
    bookType: format,
    type: "array",
    cellDates: true,
    ...(format === "csv" ? { FS: ";" } : {}),
  }) as ArrayBuffer;
  const mimeTypes: Record<ImportFileFormat, string> = {
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    csv: "text/csv",
  };

  const file = new File([bytes], `график-доставок.${format}`, {
    type: mimeTypes[format],
  });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => bytes.slice(0),
  });
  return file;
}

function buildRealFactFile(): File {
  const worksheet = XLSX.utils.json_to_sheet([
    {
      Объект: "Объект Альфа",
      Водитель: "Иван Водитель",
      "Плановая дата": new Date(Date.UTC(2026, 8, 15)),
      "Дата факта": new Date(Date.UTC(2026, 8, 16)),
    },
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Факт");
  const bytes = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
    cellDates: true,
  }) as ArrayBuffer;

  const file = new File([bytes], "факт-доставок.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => bytes.slice(0),
  });
  return file;
}

async function selectImportFile(
  user: ReturnType<typeof userEvent.setup>,
  mode: "add" | "replace",
  options?: {
    includeMissingSites?: boolean;
    format?: ImportFileFormat;
  },
) {
  await user.click(
    screen.getByTestId(
      mode === "add"
        ? "button-add-deliveries-from-file"
        : "button-import-deliveries",
    ),
  );
  await user.upload(
    screen.getByTestId("input-import-deliveries"),
    buildRealImportFile(options),
  );
  await screen.findByRole("heading", {
    name: `Перед загрузкой будут пропущены строки: ${options?.includeMissingSites ? 4 : 2}`,
  });
}

describe("рабочее место логиста: импорт и фильтры", () => {
  it("сворачивает панель над таблицей, сохраняя фильтры, поиск и действия", async () => {
    window.localStorage.clear();
    try {
      deliveryTestState.deliveries = [];
      const { unmount } = render(<Deliveries />);
      fireEvent.change(screen.getByTestId("filter-correctedPlannedDate"), {
        target: { value: "2026-10-01" },
      });
      fireEvent.click(screen.getByTestId("button-collapse-deliveries-top"));

      expect(screen.getByTestId("deliveries-compact-top").textContent).toContain("Логистика");
      expect(screen.getByTestId("badge-compact-active-filters").textContent).toBe("Фильтры: 1");
      expect(screen.getByTestId("tab-workspace").closest(".hidden")).not.toBeNull();
      expect(screen.getByTestId("text-page-title").closest(".hidden")).not.toBeNull();
      expect(screen.getByTestId("filter-correctedPlannedDate").closest(".\\!hidden")).not.toBeNull();
      expect((screen.getByTestId("filter-correctedPlannedDate") as HTMLInputElement).value).toBe("2026-10-01");
      expect(screen.getByTestId("input-search-deliveries-workspace").closest(".hidden")).toBeNull();
      expect(screen.getByTestId("button-add-delivery")).toBeTruthy();
      expect(window.localStorage.getItem("lexitd.deliveries-top-collapsed")).toBe("true");

      unmount();
      render(<Deliveries />);
      expect(screen.getByTestId("deliveries-compact-top")).toBeTruthy();
      fireEvent.click(screen.getByTestId("button-expand-deliveries-top"));
      expect(screen.queryByTestId("deliveries-compact-top")).toBeNull();
      expect(screen.getByTestId("tab-workspace").closest(".hidden")).toBeNull();
      expect(window.localStorage.getItem("lexitd.deliveries-top-collapsed")).toBe("false");
    } finally {
      window.localStorage.clear();
    }
  });

  it("выгружает сводку водителей отдельно от обычной выгрузки доставок", () => {
    render(<Deliveries />);
    fireEvent.click(screen.getByTestId("tab-driver-summary"));
    fireEvent.click(screen.getByRole("button", { name: "Сводка водителей в Excel" }));
    expect(exportDriverProgressSpy).toHaveBeenCalledOnce();
    expect(exportDriverProgressSpy.mock.calls[0][0]).toEqual(deliveryTestState.deliveries);
    expect(exportDriverProgressSpy.mock.calls[0][2]).toMatch(/^\d{4}-\d{2}$/);
    expect(exportDriverProgressSpy.mock.calls[0][3]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(exportRowsToExcelSpy).not.toHaveBeenCalled();
  });

  it("не выгружает ложную пустую сводку при ошибке загрузки", () => {
    deliveryTestState.deliveriesError = true;
    render(<Deliveries />);
    fireEvent.click(screen.getByTestId("tab-driver-summary"));
    expect((screen.getByRole("button", { name: "Сводка водителей в Excel" }) as HTMLButtonElement).disabled).toBe(true);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    deliveryTestState.deliveries = [];
    deliveryTestState.adminAccess = false;
    deliveryTestState.role = "logistician";
    deliveryTestState.canApproveActs = false;
    deliveryTestState.deliveriesError = false;
    deliveryTestState.deliveriesStaleError = false;
    deliveryTestState.sitesError = false;
    deliveryTestState.deliveriesLoading = false;
    deliveryTestState.sitesLoading = false;
    deliveryTestState.deliveriesFetching = false;
    deliveryTestState.sitesFetching = false;
    deliveryTestState.driversLoading = false;
    deliveryTestState.driversError = false;
    deliveryTestState.emptyDrivers = false;
    deliveryTestState.pendingMonth = null;
    downloadFileResponse.mockResolvedValue(undefined);
    updateActualBulkRequest.mockResolvedValue({ updated: 1 });
    window.history.replaceState({}, "", "/?month=2026-09");
  });

  it.each(["admin", "logistician", "manager"] as const)(
    "allows %s to navigate backwards and requests September in every tab without writes",
    async (role) => {
      deliveryTestState.adminAccess = role === "admin";
      deliveryTestState.role = role === "manager" ? "manager" : "logistician";
      window.history.replaceState({}, "", "/?month=2026-10");
      const user = userEvent.setup();
      render(<Deliveries />);
      await user.click(screen.getByTestId("button-previous-delivery-month"));
      expect(listDeliveriesQuery).toHaveBeenCalledWith({ month: "2026-09", archived: false });
      expect((screen.getByTestId("input-month-selector") as HTMLSelectElement).value).toBe("09");
      expect((screen.getByTestId("input-year-selector") as HTMLInputElement).value).toBe("2026");
      await user.click(screen.getByTestId("tab-schedule"));
      expect(listDeliveriesQuery).toHaveBeenLastCalledWith({ month: "2026-09", archived: true });
      await user.click(screen.getByTestId("tab-driver-summary"));
      expect(screen.getByTestId("driver-summary-sheet")).toBeTruthy();
      await user.click(screen.getByTestId("tab-archived-deliveries"));
      expect(listDeliveriesQuery).toHaveBeenLastCalledWith({ month: "2026-09", archived: true });
      expect(createDeliveryRequest).not.toHaveBeenCalled();
      expect(createBulkRequest).not.toHaveBeenCalled();
      expect(replaceBulkRequest).not.toHaveBeenCalled();
      expect(updateActualBulkRequest).not.toHaveBeenCalled();
    },
  );

  it("keeps September selected and shows a retry error instead of zero deliveries on load failure", async () => {
    window.history.replaceState({}, "", "/?month=2026-10");
    deliveryTestState.deliveriesError = true;
    const user = userEvent.setup();
    render(<Deliveries />);
    await user.click(screen.getByTestId("button-previous-delivery-month"));
    await user.click(screen.getByTestId("tab-schedule"));
    expect(listDeliveriesQuery).toHaveBeenCalledWith({ month: "2026-09", archived: false });
    expect(screen.getByTestId("deliveries-main-error")).toBeTruthy();
    expect(screen.queryByTestId("counter-schedule-rows")).toBeNull();
    expect(screen.queryByTestId("delivery-month-progress")).toBeNull();
    await user.click(screen.getByTestId("button-retry-deliveries-main"));
    expect(refetchDeliveries).toHaveBeenCalled();
    expect(refetchSites).toHaveBeenCalled();
    expect((screen.getByTestId("input-month-selector") as HTMLSelectElement).value).toBe("09");
  });

  it("exports the September facts selected with previous-month navigation", async () => {
    deliveryTestState.adminAccess = true;
    deliveryTestState.deliveries = [{
      id: "september-export",
      siteId: "site-alpha",
      siteName: "Объект Альфа",
      driver: "Иван Водитель",
      driverUserId: "driver-1",
      scheduleMonth: "2026-09",
      plannedDate: "2026-09-15",
      actualDate: null,
      workflowStatus: "planned",
      photosCount: 0,
      lagDays: null,
    }];
    window.history.replaceState({}, "", "/?month=2026-10");
    const user = userEvent.setup();
    render(<Deliveries />);
    await user.click(screen.getByTestId("button-previous-delivery-month"));
    await user.click(screen.getByTestId("button-export-delivery-facts"));
    expect(exportRowsToExcelSpy).toHaveBeenCalledWith(
      [{
        Объект: "Объект Альфа",
        Водитель: "Иван Водитель",
        "Плановая дата": "15.09.2026",
        "Дата факта": "",
      }],
      expect.any(Array),
      "факт-доставок-2026-09.xlsx",
    );
  });

  it("выгружает шаблон без email с двумя скрытыми справочниками из текущих API", async () => {
    deliveryTestState.adminAccess = true;
    render(<Deliveries />);
    await userEvent.setup().click(screen.getByTestId("button-download-template"));
    expect(downloadTemplateSpy).toHaveBeenCalledTimes(1);
    const [headers, filename, references] = downloadTemplateSpy.mock.calls[0];
    expect(headers).toEqual(["Объект", "Водитель", "Плановая дата"]);
    expect(filename).toBe("шаблон-график-доставок.xlsx");
    expect(references).toEqual([
      { name: "Справочник объектов", headers: ["Объект"], rows: [{ Объект: "Объект Альфа" }, { Объект: "Объект Бета" }], dropdownForHeader: "Объект", dropdownError: expect.any(String), allowBlank: false, hidden: true },
      { name: "Справочник водителей", headers: ["Водитель"], rows: [{ Водитель: "Иван Водитель" }], dropdownForHeader: "Водитель", dropdownError: expect.any(String), hidden: true },
    ]);
  });

  it.each(["sitesLoading", "sitesFetching", "sitesError", "driversLoading", "driversError", "emptyDrivers"] as const)(
    "не выгружает неполный шаблон при %s", (state) => {
      deliveryTestState.adminAccess = true;
      deliveryTestState[state] = true;
      render(<Deliveries />);
      expect((screen.getByTestId("button-download-template") as HTMLButtonElement).disabled).toBe(true);
      expect(downloadTemplateSpy).not.toHaveBeenCalled();
      deliveryTestState[state] = false;
    },
  );

  it("закрепляет объект, ставит водителя вторым и отклонение после комментария", () => {
    deliveryTestState.deliveries = [{
      id: "column-order",
      siteId: "site-alpha",
      siteName: "Объект Альфа",
      driver: "Иван Водитель",
      driverUserId: "driver-1",
      plannedDate: "2026-09-01",
      actualDate: "2026-09-04",
      workflowStatus: "done",
      photosCount: 0,
      lagDays: 3,
      note: "Комментарий для проверки",
    }];
    render(<Deliveries />);
    const row = screen.getByTestId("row-delivery-column-order");
    const table = row.closest("table")!;
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent?.replace(/[▲▼]/g, "").trim())).toEqual([
      "Объект", "Водитель", "Куст", "Адрес", "План дата", "ДатаПланКорр", "Факт дата",
      "Тип поставки", "Особенности", "Менеджер", "Примечание логиста",
      "Комментарий водителя", "Отклонение", "Действия",
    ]);
    expect(headers[0].classList.contains("sticky")).toBe(true);
    expect(headers[0].classList.contains("left-0")).toBe(true);
    const cells = within(row).getAllByRole("cell");
    expect(cells).toHaveLength(14);
    expect(cells[0].classList.contains("sticky")).toBe(true);
    expect(cells[0].classList.contains("left-0")).toBe(true);
    expect(cells[1].textContent).toContain("Иван Водитель");
    expect(cells[2].textContent).toBe("Куст Альфа");
    expect(cells[3].textContent).toBe("Адрес Альфа");
    expect(cells[11].textContent).toBe("Комментарий для проверки");
    expect(cells[12].textContent).toBe("+3");
    const mobile = within(screen.getByTestId("mobile-card-delivery-column-order"));
    expect(mobile.getByText("Объект Альфа")).toBeTruthy();
    expect(mobile.getByText("Иван Водитель")).toBeTruthy();
    expect(mobile.getByText("Выполнена")).toBeTruthy();
    expect(mobile.getByTestId("mobile-card-button-fact-column-order")).toBeTruthy();
    expect(mobile.getByTestId("mobile-card-button-acts-column-order")).toBeTruthy();
    expect(mobile.getByTestId("mobile-card-button-comment-column-order")).toBeTruthy();
    expect(mobile.getByTestId("mobile-card-button-delete-column-order")).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-filter-no-deliveries"));
    const missing = within(screen.getByTestId("row-site-without-delivery-site-beta")).getAllByRole("cell");
    expect(missing).toHaveLength(14);
    expect(missing[0].classList.contains("sticky")).toBe(true);
    expect(missing[1].textContent).toBe("Иван Водитель");
    expect(missing[2].textContent).toBe("");
    expect(missing[3].textContent).toBe("Адрес Бета");
    expect(missing[12].textContent).toBe("—");
  });

  it("открывает сводку отдельной вкладкой после логистики, независимо от её фильтров", async () => {
    const user = userEvent.setup();
    deliveryTestState.deliveries = [
      { actualDate: null, workflowStatus: "planned", photosCount: 0 },
      { actualDate: "2026-09-02", workflowStatus: "done", photosCount: 2 },
      { actualDate: "2026-09-02", workflowStatus: "closed", photosCount: 1 },
    ].map((fields, index) => ({
      id: `summary-${index}`,
      siteId: "site-alpha",
      siteName: "Объект Альфа",
      driver: "Иван Водитель",
      driverUserId: "driver-1",
      scheduleMonth: "2026-09",
      plannedDate: "2026-09-01",
      correctedPlannedDate: "2026-09-03",
      lagDays: 0,
      ...fields,
    }));
    const { rerender } = render(<Deliveries />);
    fireEvent.change(screen.getByTestId("filter-correctedPlannedDate"), {
      target: { value: "2026-10-01" },
    });
    const summaryTab = screen.getByTestId("tab-driver-summary");
    expect(summaryTab.previousElementSibling).toBe(screen.getByTestId("tab-workspace"));
    expect(summaryTab.nextElementSibling).toBe(screen.getByTestId("tab-schedule"));
    await user.click(summaryTab);
    const row = within(screen.getByTestId("driver-summary-row-driver-1"));
    const cells = row.getAllByRole("cell");
    expect(within(cells[1]).getByLabelText("План за месяц, шт: 3")).toBeTruthy();
    expect(within(cells[1]).getByLabelText("Не выполнено за месяц, шт: 1")).toBeTruthy();
    expect(within(cells[2]).getByLabelText("Выполнено за месяц, %: 33,3%")).toBeTruthy();
    expect(within(cells[2]).getByLabelText("Закрыто за месяц, %: 33,3%")).toBeTruthy();
    expect(within(cells[3]).getByLabelText("План: 3")).toBeTruthy();

    deliveryTestState.deliveries = deliveryTestState.deliveries.map((item) => ({
      ...item, actualDate: "2026-09-02", workflowStatus: "closed",
    }));
    rerender(<Deliveries />);
    expect(within(within(screen.getByTestId("driver-summary-row-driver-1")).getAllByRole("cell")[2])
      .getByLabelText("Закрыто за месяц, %: 100%")).toBeTruthy();

    fireEvent.change(screen.getByTestId("input-month-selector"), { target: { value: "02" } });
    const february = within(screen.getByTestId("driver-summary-row-driver-1")).getAllByRole("cell");
    expect(february).toHaveLength(31);
    expect(within(february[1]).getByLabelText("План за месяц, шт: 0")).toBeTruthy();
    await user.click(screen.getByTestId("tab-schedule"));
    expect(screen.queryByTestId("driver-summary-sheet")).toBeNull();
    expect(screen.getByTestId("counter-schedule-rows")).toBeTruthy();
  });

  it("считает дневную сводку и её фильтры по одной плановой дате, включая закрытые в процент", async () => {
    const user = userEvent.setup();
    deliveryTestState.deliveries = [
      { plannedDate: "2026-09-11", actualDate: null, workflowStatus: "planned", photosCount: 0 },
      { plannedDate: "2026-09-11", actualDate: "2026-09-14", workflowStatus: "done", photosCount: 2 },
      { plannedDate: "2026-09-11", actualDate: "2026-09-12", workflowStatus: "closed", photosCount: 1 },
      { plannedDate: "2026-09-10", actualDate: "2026-09-11", workflowStatus: "closed", photosCount: 1 },
    ].map((fields, index) => ({
      id: `planned-cohort-${index}`,
      siteId: `planned-site-${index}`,
      siteName: `Плановый объект ${index}`,
      driver: "Иван Водитель",
      driverUserId: "driver-1",
      scheduleMonth: "2026-09",
      lagDays: 0,
      ...fields,
    }));
    render(<Deliveries />);
    fireEvent.change(screen.getByTestId("input-month-selector"), { target: { value: "09" } });
    await user.click(screen.getByTestId("tab-schedule"));
    expect(screen.getByTestId("button-schedule-plan-11").textContent).toBe("3");
    // Выполнено includes closed deliveries, matching the cumulative 66.7% below.
    expect(screen.getByTestId("button-schedule-done-11").textContent).toBe("2");
    expect(screen.getByTestId("button-schedule-closed-11").textContent).toBe("1");
    expect(screen.getByTestId("button-schedule-failed-11").textContent).toBe("1");
    expect(screen.getByTestId("schedule-done-percent-11").textContent).toBe("66,7%");
    expect(screen.getByTestId("schedule-done-percent-30").textContent).toBe("—");
    const scheduleTable = screen.getByTestId("schedule-done-percent-11").closest("table")!;
    expect(scheduleTable.style.width).toBe("100%");
    expect(scheduleTable.style.minWidth).toBe(`${470 + 30 * 44}px`);
    expect(scheduleTable.querySelectorAll("col")).toHaveLength(33);
    await user.click(screen.getByTestId("button-schedule-closed-11"));
    expect(screen.getByRole("link", { name: "Плановый объект 2" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Плановый объект 3" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Плановый объект 1" })).toBeNull();
    expect(screen.getByTestId("schedule-done-percent-11").textContent).toBe("66,7%");
  });

  it("добавляет доставку из полной формы с датами и данными объекта без их изменения", async () => {
    deliveryTestState.adminAccess = true;
    const user = userEvent.setup();
    render(<Deliveries />);
    await user.click(screen.getByTestId("button-add-delivery"));
    for (const [testId, value] of [
      ["input-create-address", "Адрес Альфа"],
      ["input-create-branch", "Куст Альфа"],
      ["input-create-manager", "Менеджер Альфа"],
      ["input-create-features", "Вход со двора"],
    ]) {
      const input = screen.getByTestId(testId) as HTMLInputElement;
      expect(input.value).toBe(value);
      expect(input.readOnly).toBe(true);
    }
    fireEvent.change(screen.getByTestId("input-create-planned-date"), {
      target: { value: "2026-09-15" },
    });
    fireEvent.change(screen.getByTestId("input-create-actual-date"), {
      target: { value: "2026-09-17" },
    });
    fireEvent.change(screen.getByTestId("input-create-corrected-date"), {
      target: { value: "2026-10-02" },
    });
    expect((screen.getByTestId("output-create-lag") as HTMLInputElement).value).toBe("2");
    expect(createDeliveryRequest).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("button-submit-create-delivery"));
    expect(await screen.findByText("Выберите тип поставки")).toBeTruthy();
    expect(createDeliveryRequest).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId("select-create-delivery-type"), {
      key: "ArrowDown",
      code: "ArrowDown",
    });
    fireEvent.keyDown(screen.getByRole("option", { name: "Коробка" }), {
      key: "Enter",
      code: "Enter",
    });
    await user.click(screen.getByTestId("button-submit-create-delivery"));
    await waitFor(() => expect(createDeliveryRequest).toHaveBeenCalledWith({
      data: {
        siteId: "site-alpha",
        driverUserId: "driver-1",
        plannedDate: "2026-09-15",
        scheduleMonth: "2026-09",
        actualDate: "2026-09-17",
        correctedPlannedDate: "2026-10-02",
        deliveryType: "Коробка",
      },
    }));
  });

  it("не отправляет фактическую дату без плана и сохраняет введённые данные", async () => {
    deliveryTestState.adminAccess = true;
    const user = userEvent.setup();
    render(<Deliveries />);
    await user.click(screen.getByTestId("button-add-delivery"));
    fireEvent.change(screen.getByTestId("input-create-actual-date"), {
      target: { value: "2026-09-17" },
    });
    await user.click(screen.getByTestId("button-submit-create-delivery"));
    expect(await screen.findByText("Факт. дата требует плановую")).toBeTruthy();
    expect(createDeliveryRequest).not.toHaveBeenCalled();
    expect((screen.getByTestId("input-create-actual-date") as HTMLInputElement).value).toBe("2026-09-17");
  });

  it("фильтрует корректировки по наличию и дате, обновляет количество после очистки", async () => {
    const user = userEvent.setup();
    deliveryTestState.deliveries = ["alpha", "beta"].map((suffix, index) => ({
      id: `delivery-${suffix}`,
      siteId: `site-${suffix}`,
      siteName: index === 0 ? "Объект Альфа" : "Объект Бета",
      plannedDate: "2026-09-15",
      correctedPlannedDate: index === 0 ? "2026-10-02" : null,
      actualDate: null,
      driver: "Иван Водитель",
      driverUserId: "driver-1",
      lagDays: 0,
      photosCount: 0,
    }));
    const { rerender } = render(<Deliveries />);
    const correctionButton = screen.getByTestId("button-filter-corrected-plan");
    expect(correctionButton.textContent).toContain("1 (50%)");
    await user.click(correctionButton);
    expect(screen.getByTestId("counter-workspace-rows").textContent).toContain("1");
    expect(screen.queryByTestId("row-delivery-delivery-beta")).toBeNull();
    await user.click(correctionButton);
    expect(screen.getByTestId("counter-workspace-rows").textContent).toContain("2");

    const dateFilter = screen.getByTestId("filter-correctedPlannedDate");
    expect(dateFilter.hasAttribute("max")).toBe(false);
    fireEvent.change(dateFilter, { target: { value: "2026-10-02" } });
    expect(screen.getByTestId("counter-workspace-rows").textContent).toContain("1");
    fireEvent.change(dateFilter, { target: { value: "2026-10-03" } });
    expect(screen.getByTestId("counter-workspace-rows").textContent).toContain("0");
    await user.click(screen.getByTestId("button-reset-filters"));
    expect(screen.getByTestId("counter-workspace-rows").textContent).toContain("2");

    deliveryTestState.deliveries = deliveryTestState.deliveries.map((delivery) => ({
      ...delivery,
      correctedPlannedDate: null,
    }));
    rerender(<Deliveries />);
    expect(correctionButton.textContent).toContain("0 (0%)");
  });

  it("показывает телефон в ячейке менеджера и находит доставку по номеру", () => {
    deliveryTestState.deliveries = ["alpha", "beta"].map((suffix) => ({
      id: `delivery-${suffix}`,
      siteId: `site-${suffix}`,
      siteName: `Объект ${suffix}`,
      plannedDate: "2026-09-15",
      actualDate: null,
      driver: "Иван Водитель",
      driverUserId: "driver-1",
      lagDays: 0,
      photosCount: 0,
    }));
    render(<Deliveries />);
    const row = within(screen.getByTestId("row-delivery-delivery-alpha"));
    const call = row.getByRole("link", { name: /Позвонить менеджеру Менеджер Альфа/ });
    expect(call.getAttribute("href")).toBe("tel:+79991234567");
    expect(call.textContent).toBe("+7 (999) 123-45-67");
    expect(row.getByText("Менеджер Альфа")).toBeTruthy();
    expect(within(screen.getByTestId("row-delivery-delivery-beta")).queryByRole("link", { name: /Позвонить менеджеру/ })).toBeNull();

    fireEvent.change(screen.getByTestId("input-search-deliveries-workspace"), {
      target: { value: "123-45-67" },
    });
    expect(screen.getByTestId("row-delivery-delivery-alpha")).toBeTruthy();
    expect(screen.queryByTestId("row-delivery-delivery-beta")).toBeNull();
  });

  it("показывает телефон менеджера у объекта без доставок", () => {
    render(<Deliveries />);
    fireEvent.click(screen.getByTestId("button-filter-no-deliveries"));
    const row = within(screen.getByTestId("row-site-without-delivery-site-alpha"));
    expect(row.getByRole("link", { name: /Позвонить менеджеру/ }).getAttribute("href")).toBe("tel:+79991234567");
    fireEvent.change(screen.getByTestId("input-search-deliveries-workspace"), {
      target: { value: "123-45-67" },
    });
    expect(screen.getByTestId("row-site-without-delivery-site-alpha")).toBeTruthy();
    expect(screen.queryByTestId("row-site-without-delivery-site-beta")).toBeNull();
  });

  it("показывает полный отчёт и отменяет импорт без API-запроса", async () => {
    deliveryTestState.adminAccess = true;
    const user = userEvent.setup();
    render(<Deliveries />);

    await selectImportFile(user, "add");

    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("Объект Бета")).toBeTruthy();
    expect(screen.getByText("Объект Альфа")).toBeTruthy();
    expect(screen.getByText(/относится к другому месяцу/)).toBeTruthy();
    expect(screen.getByText(/Повтор объекта на 2026-09-15/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Отмена" }));

    expect(createBulkRequest).not.toHaveBeenCalled();
    expect(replaceBulkRequest).not.toHaveBeenCalled();
  });

  it.each(["add", "replace"] as const)(
    "блокирует режим %s, когда настоящий XLSX содержит отсутствующие объекты",
    async (mode) => {
      deliveryTestState.adminAccess = true;
      const user = userEvent.setup();
      render(<Deliveries />);

      await selectImportFile(user, mode, { includeMissingSites: true });

      for (const rowNumber of ["3", "4", "5", "6"]) {
        expect(screen.getByText(rowNumber)).toBeTruthy();
      }
      expect(screen.getByText("Новый объект Гамма")).toBeTruthy();
      expect(screen.getByText("Новый объект Дельта")).toBeTruthy();
      expect(screen.getAllByText("Объект не найден в справочнике")).toHaveLength(2);
      expect(screen.getByText("Объект Бета")).toBeTruthy();
      expect(screen.getByText(/относится к другому месяцу/)).toBeTruthy();
      expect(screen.getByText("Объект Альфа")).toBeTruthy();
      expect(screen.getByText(/Повтор объекта на 2026-09-15/)).toBeTruthy();
      expect(
        screen.getByText(/Сначала добавьте отсутствующие объекты в справочник/),
      ).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Загрузить остальные" }),
      ).toBeNull();
      expect(createBulkRequest).not.toHaveBeenCalled();
      expect(replaceBulkRequest).not.toHaveBeenCalled();
    },
  );

  it("в режиме add отправляет только допустимую строку", async () => {
    deliveryTestState.adminAccess = true;
    window.history.replaceState({}, "", "/?month=2026-10");
    const user = userEvent.setup();
    render(<Deliveries />);
    await user.click(screen.getByTestId("button-previous-delivery-month"));

    await selectImportFile(user, "add");
    await user.click(
      screen.getByRole("button", { name: "Загрузить остальные" }),
    );

    expect(createBulkRequest).toHaveBeenCalledWith({
      data: {
        items: [
          {
            siteId: "site-alpha",
            driverUserId: "driver-1",
            plannedDate: "2026-09-15",
            scheduleMonth: "2026-09",
          },
        ],
      },
    });
    expect(replaceBulkRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["старый Excel", "xls"],
    ["CSV", "csv"],
  ] as const)(
    "в режиме add читает заголовки и даты из настоящего файла %s",
    async (_label, format) => {
      deliveryTestState.adminAccess = true;
      const user = userEvent.setup();
      render(<Deliveries />);

      await selectImportFile(user, "add", { format });
      await user.click(
        screen.getByRole("button", { name: "Загрузить остальные" }),
      );

      expect(createBulkRequest).toHaveBeenCalledWith({
        data: {
          items: [
            {
              siteId: "site-alpha",
              driverUserId: "driver-1",
              plannedDate: "2026-09-15",
              scheduleMonth: "2026-09",
            },
          ],
        },
      });
      expect(replaceBulkRequest).not.toHaveBeenCalled();
    },
  );

  it("в режиме replace подтверждает замену и отправляет выбранный месяц", async () => {
    deliveryTestState.adminAccess = true;
    window.history.replaceState({}, "", "/?month=2026-10");
    const user = userEvent.setup();
    render(<Deliveries />);
    await user.click(screen.getByTestId("button-previous-delivery-month"));

    await selectImportFile(user, "replace");
    await user.click(
      screen.getByRole("button", { name: "Загрузить остальные" }),
    );
    await screen.findByRole("heading", {
      name: "Полностью заменить график месяца?",
    });
    await user.click(
      screen.getByRole("button", { name: "Удалить и загрузить заново" }),
    );

    await waitFor(() =>
      expect(replaceBulkRequest).toHaveBeenCalledWith({
        data: {
          month: "2026-09",
          items: [
            {
              siteId: "site-alpha",
              driverUserId: "driver-1",
              plannedDate: "2026-09-15",
              scheduleMonth: "2026-09",
            },
          ],
        },
      }),
    );
    expect(createBulkRequest).not.toHaveBeenCalled();
  });

  it("загружает факт сразу за несколько дней выбранного месяца", async () => {
    deliveryTestState.adminAccess = true;
    deliveryTestState.deliveries = [
      {
        id: "delivery-alpha",
        siteId: "site-alpha",
        siteName: "Объект Альфа",
        siteAddress: "Адрес Альфа",
        driverUserId: "driver-1",
        driver: "Иван Водитель",
        plannedDate: "2026-09-15",
        scheduleMonth: "2026-09",
        actualDate: null,
        actApprovedAt: null,
        actApprovedBy: null,
        workflowStatus: "pending",
        note: null,
        logisticianNote: null,
        status: "pending",
        lagDays: null,
        rescheduledFromDate: null,
        rescheduledBy: null,
        rescheduledAt: null,
        photosCount: 0,
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    const user = userEvent.setup();
    render(<Deliveries />);

    await user.click(screen.getByTestId("button-import-delivery-facts"));
    await user.upload(
      screen.getByTestId("input-import-delivery-facts"),
      buildRealFactFile(),
    );

    await waitFor(() =>
      expect(updateActualBulkRequest).toHaveBeenCalledWith({
        items: [{ id: "delivery-alpha", actualDate: "2026-09-16" }],
      }),
    );
  });

  it("выгружает акты с границами выбранного месяца", async () => {
    deliveryTestState.canApproveActs = true;
    window.history.replaceState({}, "", "/?month=2026-10");
    const user = userEvent.setup();
    render(<Deliveries />);
    await user.click(screen.getByTestId("button-previous-delivery-month"));

    await user.click(screen.getByTestId("button-export-delivery-acts"));
    expect(
      (screen.getByTestId("input-acts-export-from") as HTMLInputElement).value,
    ).toBe("2026-09-01");
    expect(
      (screen.getByTestId("input-acts-export-to") as HTMLInputElement).value,
    ).toBe("2026-09-30");
    await user.click(screen.getByRole("button", { name: "Скачать ZIP" }));

    await waitFor(() =>
      expect(downloadFileResponse).toHaveBeenCalledWith(
        "/api/deliveries/acts/download?from=2026-09-01&to=2026-09-30",
        "акты-2026-09-01-2026-09-30.zip",
      ),
    );
    expect(toast).toHaveBeenCalledWith({ title: "Скачивание архива начато" });
  });

  it("показывает понятную ошибку пустой выгрузки актов", async () => {
    deliveryTestState.canApproveActs = true;
    downloadFileResponse.mockRejectedValue(
      new Error("За выбранный период акты не найдены"),
    );
    const user = userEvent.setup();
    render(<Deliveries />);

    await user.click(screen.getByTestId("button-export-delivery-acts"));
    await user.click(screen.getByRole("button", { name: "Скачать ZIP" }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: "За выбранный период актов нет",
        description: "За выбранный период акты не найдены",
        variant: "default",
      }),
    );
  });
});