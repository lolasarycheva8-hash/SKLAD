import "./select-jsdom-compat";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bulkMutate: vi.fn(),
  downloadTemplate: vi.fn(),
  sheetHeaders: [] as string[],
  sheetRows: [] as Record<string, unknown>[],
  sitesRefetch: vi.fn(),
}));

const SITES = [
  { id: "s1", name: "Лесная 5", closedFrom: null },
  { id: "s2", name: "Закрытый", closedFrom: "2024-01-01" },
];

vi.mock("@workspace/api-client-react", () => {
  const mutation = () => ({ isPending: false, mutate: vi.fn() });
  return {
    getListInventoryRecordsQueryKey: () => ["inventory-records"],
    useListInventoryRecords: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
    useCreateInventoryRecord: mutation,
    useUpdateInventoryRecord: mutation,
    useDeleteInventoryRecord: mutation,
    useBulkCreateInventoryRecords: () => ({ isPending: false, mutate: mocks.bulkMutate }),
    useListSites: () => ({ data: SITES, isLoading: false, isFetching: false, refetch: mocks.sitesRefetch }),
  };
});

vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/excel-import", () => ({
  downloadTemplate: mocks.downloadTemplate,
  readSheetHeaders: async () => mocks.sheetHeaders,
  parseExcelFile: async () => mocks.sheetRows,
}));

import Stock from "@/pages/stock";
import { templateHeaders } from "@/lib/stock-import";

beforeEach(() => {
  mocks.sitesRefetch.mockResolvedValue({ data: SITES, isError: false });
});
afterEach(cleanup);

function upload() {
  const input = screen.getByTestId("input-xlsx") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "f.xlsx")] } });
}

it("keeps upload disabled until the tab's template downloads, then uses only active sites", async () => {
  render(<Stock />);
  expect(screen.getByTestId("button-upload-xlsx") as HTMLButtonElement).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByTestId("button-download-template"));
  await waitFor(() => expect(screen.getByTestId("button-upload-xlsx") as HTMLButtonElement).toHaveProperty("disabled", false));
  const refs = mocks.downloadTemplate.mock.calls[0][2];
  expect(refs[0].rows).toEqual([{ Объект: "Лесная 5" }]);
});

it("does not enable upload when the sites list fails", async () => {
  mocks.sitesRefetch.mockResolvedValue({ data: undefined, isError: true });
  render(<Stock />);
  fireEvent.click(screen.getByTestId("button-download-template"));
  await waitFor(() => expect(mocks.sitesRefetch).toHaveBeenCalled());
  expect(mocks.downloadTemplate).not.toHaveBeenCalled();
  expect(screen.getByTestId("button-upload-xlsx") as HTMLButtonElement).toHaveProperty("disabled", true);
});

it("shows row errors for an invalid file and blocks import", async () => {
  mocks.sheetHeaders = templateHeaders("equipment");
  mocks.sheetRows = [
    { Наименование: "Насос", "Инвентарный номер": "A-1", Объект: "Нет такого" },
    { Наименование: "Насос 2", "Инвентарный номер": "a-1" },
  ];
  render(<Stock />);
  fireEvent.click(screen.getByTestId("button-download-template"));
  await waitFor(() => expect(screen.getByTestId("button-upload-xlsx") as HTMLButtonElement).toHaveProperty("disabled", false));
  upload();
  const list = await screen.findByTestId("list-import-errors");
  expect(list.textContent).toContain("Строка 2");
  expect(list.textContent).toContain("не найден");
  expect(list.textContent).toContain("дубликат");
  expect(screen.queryByTestId("button-confirm-import")).toBeNull();
});

it("previews a valid file and submits one bulk request", async () => {
  mocks.sheetHeaders = templateHeaders("equipment");
  mocks.sheetRows = [{ Наименование: "Насос", "Инвентарный номер": "A-1", Объект: "лесная 5" }];
  render(<Stock />);
  fireEvent.click(screen.getByTestId("button-download-template"));
  await waitFor(() => expect(screen.getByTestId("button-upload-xlsx") as HTMLButtonElement).toHaveProperty("disabled", false));
  upload();
  const confirm = await screen.findByTestId("button-confirm-import");
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(mocks.bulkMutate).toHaveBeenCalledTimes(1);
  const rows = mocks.bulkMutate.mock.calls[0][0].data.rows;
  expect(rows[0]).toMatchObject({ kind: "equipment", inventoryNumber: "A-1", siteId: "s1", quantity: 1 });
});
