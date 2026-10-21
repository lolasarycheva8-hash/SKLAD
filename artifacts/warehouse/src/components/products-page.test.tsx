import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canEditProducts: true,
  products: [
    {
      id: "product-1",
      name: "Существующий товар",
      sku: "SKU-1",
      unit: "шт",
      purchasePrice: 10,
      price: 15,
      categoryId: null,
      categoryName: null,
      minStock: 2,
      currentStock: 4,
      supplier: null,
      supplierContact: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  createMutation: null as {
    onError?: (error: Error) => void;
  } | null,
  updateMutation: null as {
    onError?: (error: Error) => void;
  } | null,
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetDashboardSummaryQueryKey: () => ["dashboard-summary"],
  getListCategoriesQueryKey: () => ["categories"],
  getListProductsQueryKey: () => ["products"],
  useCreateCategory: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useCreateProduct: (options: {
    mutation: { onError?: (error: Error) => void };
  }) => {
    mocks.createMutation = options.mutation;
    return {
      isPending: false,
      mutate: mocks.createProduct,
    };
  },
  useCreateProductsBulk: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useDeleteCategory: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useDeleteProduct: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useListCategories: () => ({
    data: [],
    refetch: vi.fn(),
  }),
  useListProducts: () => ({
    data: mocks.products,
    isLoading: false,
  }),
  useUpdateProduct: (options: {
    mutation: { onError?: (error: Error) => void };
  }) => {
    mocks.updateMutation = options.mutation;
    return {
      isPending: false,
      mutate: mocks.updateProduct,
    };
  },
}));

vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    canEdit: () => mocks.canEditProducts,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import Products from "@/pages/products";

function renderProducts() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Products />
    </QueryClientProvider>,
  );
}

function setInput(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

function fillRequiredProductFields(name = "Новый товар") {
  setInput("input-product-name", name);
  setInput("input-product-sku", "SKU-NEW");
  setInput("input-product-purchase-price", "12.5");
  setInput("input-product-price", "20");
}

function submitProductForm() {
  fireEvent.submit(screen.getByTestId("button-submit-product").closest("form")!);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canEditProducts = true;
  mocks.products = [
    {
      id: "product-1",
      name: "Существующий товар",
      sku: "SKU-1",
      unit: "шт",
      purchasePrice: 10,
      price: 15,
      categoryId: null,
      categoryName: null,
      minStock: 2,
      currentStock: 4,
      supplier: null,
      supplierContact: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  mocks.createMutation = null;
  mocks.updateMutation = null;
});

afterEach(cleanup);

describe("Products manual creation", () => {
  it("opens a blank form and creates a product instead of updating", async () => {
    const user = userEvent.setup();
    renderProducts();

    await user.click(screen.getByTestId("button-add-product"));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByTestId("input-product-name") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("input-product-sku") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("input-product-unit") as HTMLInputElement).value).toBe("шт");
    expect(
      (screen.getByTestId("input-product-purchase-price") as HTMLInputElement).value,
    ).toBe("");
    expect((screen.getByTestId("input-product-price") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("input-product-min-stock") as HTMLInputElement).value).toBe(
      "0",
    );

    fillRequiredProductFields();
    submitProductForm();

    expect(mocks.createProduct).toHaveBeenCalledWith({
      data: {
        name: "Новый товар",
        sku: "SKU-NEW",
        unit: "шт",
        purchasePrice: 12.5,
        price: 20,
        categoryId: null,
        minStock: 0,
        supplier: null,
        supplierContact: null,
      },
    });
    expect(mocks.updateProduct).not.toHaveBeenCalled();
  });

  it("keeps the create draft after onError and reopens add blank", async () => {
    const user = userEvent.setup();
    renderProducts();

    await user.click(screen.getByTestId("button-add-product"));
    fillRequiredProductFields("Черновик товара");
    submitProductForm();

    const error = new Error("Не удалось сохранить товар");
    expect(mocks.createMutation).toBeTruthy();
    actOnError(mocks.createMutation?.onError, error);

    expect((screen.getByTestId("input-product-name") as HTMLInputElement).value).toBe(
      "Черновик товара",
    );
    expect((screen.getByTestId("input-product-sku") as HTMLInputElement).value).toBe(
      "SKU-NEW",
    );
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Не удалось добавить товар",
      description: "Не удалось сохранить товар",
      variant: "destructive",
    });

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByTestId("button-add-product"));

    expect((screen.getByTestId("input-product-name") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("input-product-sku") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("input-product-unit") as HTMLInputElement).value).toBe("шт");
  });

  it("does not show add controls when products are readonly", () => {
    mocks.canEditProducts = false;
    renderProducts();

    expect(screen.queryByTestId("button-add-product")).toBeNull();
    expect(screen.queryByTestId("button-edit-product-1")).toBeNull();
  });

  it("uses update for an existing product and never create", async () => {
    const user = userEvent.setup();
    renderProducts();

    await user.click(screen.getByTestId("button-edit-product-1"));
    expect(
      (screen.getByTestId("input-product-name") as HTMLInputElement).value,
    ).toBe("Существующий товар");
    setInput("input-product-name", "Изменённый товар");
    submitProductForm();

    expect(mocks.updateProduct).toHaveBeenCalledWith({
      id: "product-1",
      data: {
        name: "Изменённый товар",
        sku: "SKU-1",
        unit: "шт",
        purchasePrice: 10,
        price: 15,
        categoryId: null,
        minStock: 2,
        supplier: null,
        supplierContact: null,
      },
    });
    expect(mocks.createProduct).not.toHaveBeenCalled();
  });
});

function actOnError(
  callback: ((error: Error) => void) | undefined,
  error: Error,
) {
  act(() => callback?.(error));
}