import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  toast: vi.fn(),
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
  ClientDeleteDialog: () => null,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open: boolean;
  }) => (open ? <div>{children}</div> : null),
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

function jsonResponse(
  body: unknown,
  init: { status?: number; statusText?: string } = {},
) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
}

function renderClients() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Clients />
    </QueryClientProvider>,
  );
}

async function submitNewClient(name = "Повторяющийся клиент") {
  const user = userEvent.setup();
  await screen.findByText("Клиенты не найдены");
  await user.click(screen.getByRole("button", { name: "Добавить клиента" }));
  await user.type(screen.getByLabelText("Название"), name);
  await user.click(screen.getByRole("button", { name: "Сохранить" }));
}

describe("Clients API error integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("сохраняет JSON 409 в generated mutation и показывает серверный текст под названием без toast", async () => {
    const serverMessage = "Клиент «Север» уже существует";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        return jsonResponse(
          { error: serverMessage },
          { status: 409, statusText: "Conflict" },
        );
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderClients();
    await submitNewClient();

    const error = await screen.findByRole("alert");
    const input = screen.getByLabelText("Название");
    expect(error.textContent).toBe(serverMessage);
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/clients",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("передаёт обычную JSON 500 в общий toast", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        return jsonResponse(
          { error: "Сервис временно недоступен" },
          { status: 500, statusText: "Internal Server Error" },
        );
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderClients();
    await submitNewClient("Новый клиент");

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith({
        title: "Ошибка",
        description:
          "HTTP 500 Internal Server Error: Сервис временно недоступен",
        variant: "destructive",
      }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});