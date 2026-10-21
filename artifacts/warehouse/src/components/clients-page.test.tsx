import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRequest: vi.fn(),
  updateRequest: vi.fn(),
  deleteRequest: vi.fn(),
  invalidateQueries: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@workspace/api-client-react")
  >();

  return {
    ...actual,
    getListClientsQueryKey: () => ["clients"],
    getListDeliveriesQueryKey: () => ["deliveries"],
    getListSitesQueryKey: () => ["sites"],
    useListClients: () => ({
      data: [
        {
          id: "client-1",
          name: "Первый клиент",
          contact: null,
          siteCount: 1,
          createdAt: "2026-09-08T00:00:00.000Z",
        },
        {
          id: "client-2",
          name: "Второй клиент",
          contact: null,
          siteCount: 0,
          createdAt: "2026-09-08T00:00:00.000Z",
        },
      ],
      isLoading: false,
    }),
    useCreateClient: (options: any) => ({
      isPending: false,
      mutate: (variables: unknown) => {
        mocks
          .createRequest(variables)
          .then(options.mutation.onSuccess, options.mutation.onError);
      },
    }),
    useUpdateClient: (options: any) => ({
      isPending: false,
      mutate: (variables: unknown) => {
        mocks
          .updateRequest(variables)
          .then(options.mutation.onSuccess, options.mutation.onError);
      },
    }),
    useDeleteClient: (options: any) => ({
      isPending: false,
      mutate: (variables: unknown) => {
        mocks
          .deleteRequest(variables)
          .then(options.mutation.onSuccess, options.mutation.onError);
      },
    }),
  };
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/clients", mocks.navigate],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({ canEdit: () => true }),
}));

vi.mock("@/components/client-delete-dialog", () => ({
  ClientDeleteDialog: (props: any) =>
    props.clientName ? (
      <div>
        <span>{props.clientName}</span>
        {props.error && <div role="alert">{props.error}</div>}
        {props.blockingSites && (
          <span>Связанных объектов: {props.blockingSites.count}</span>
        )}
        <button type="button" onClick={props.onConfirm}>
          Подтвердить удаление
        </button>
        <button type="button" onClick={props.onViewSites}>
          Перейти к объектам клиента
        </button>
        <button type="button" onClick={props.onClose}>
          Закрыть удаление
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div>
        {children}
        <button type="button" onClick={() => onOpenChange(false)}>
          Закрыть форму
        </button>
      </div>
    ) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import Clients from "@/pages/clients";

const conflictError = {
  name: "ApiError",
  status: 409,
  data: { error: "Клиент с таким названием уже существует" },
  message: "HTTP 409 Conflict",
};

describe("Clients name conflict", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createRequest.mockResolvedValue({});
    mocks.updateRequest.mockResolvedValue({});
    mocks.deleteRequest.mockResolvedValue({});
  });

  it("показывает create 409 под названием и сбрасывает ошибку при вводе и закрытии", async () => {
    mocks.createRequest.mockRejectedValue(conflictError);
    const user = userEvent.setup();
    render(<Clients />);

    await user.click(screen.getByRole("button", { name: "Добавить клиента" }));
    const input = screen.getByLabelText("Название");
    await user.type(input, "Первый клиент");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain(
      "Клиент с таким названием уже существует",
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
    expect(mocks.toast).not.toHaveBeenCalled();

    await user.type(input, " новый");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Закрыть форму" }));
    await user.click(screen.getByRole("button", { name: "Добавить клиента" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("показывает update 409 под полем названия", async () => {
    mocks.updateRequest.mockRejectedValue(conflictError);
    const user = userEvent.setup();
    render(<Clients />);

    await user.click(
      screen.getByRole("button", {
        name: "Редактировать клиента Первый клиент",
      }),
    );
    const input = screen.getByLabelText("Название");
    await user.clear(input);
    await user.type(input, "Второй клиент");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(input.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Клиент с таким названием уже существует",
    );
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("оставляет обычную серверную ошибку в общем уведомлении", async () => {
    mocks.createRequest.mockRejectedValue({
      status: 500,
      message: "Сервис временно недоступен",
    });
    const user = userEvent.setup();
    render(<Clients />);

    await user.click(screen.getByRole("button", { name: "Добавить клиента" }));
    await user.type(screen.getByLabelText("Название"), "Новый клиент");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith({
        title: "Ошибка",
        description: "Сервис временно недоступен",
        variant: "destructive",
      }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Clients delete conflict", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createRequest.mockResolvedValue({});
    mocks.updateRequest.mockResolvedValue({});
    mocks.deleteRequest.mockResolvedValue({});
  });

  it("показывает 409, переходит к объектам и не переносит конфликт на другого клиента", async () => {
    mocks.deleteRequest.mockRejectedValueOnce({
      status: 409,
      message: "HTTP 409 Conflict",
      data: {
        error: "Нельзя удалить клиента, пока к нему привязаны объекты",
        code: "CLIENT_HAS_SITES",
        blockingSites: {
          count: 2,
          preview: [{ id: "site-1", name: "Склад Север" }],
        },
      },
    });
    const user = userEvent.setup();
    render(<Clients />);

    await user.click(screen.getByTestId("button-delete-client-client-1"));
    await user.click(screen.getByRole("button", { name: "Подтвердить удаление" }));
    expect(await screen.findByText("Связанных объектов: 2")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Перейти к объектам клиента" }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/sites?clientId=client-1&clientName=%D0%9F%D0%B5%D1%80%D0%B2%D1%8B%D0%B9%20%D0%BA%D0%BB%D0%B8%D0%B5%D0%BD%D1%82",
    );

    await user.click(screen.getByTestId("button-delete-client-client-2"));
    expect(screen.queryByText("Связанных объектов: 2")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});