import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogCancel: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

import { ClientDeleteDialog } from "./client-delete-dialog";

afterEach(cleanup);

it("показывает конфликт и оставляет подтверждение удаления доступным", async () => {
  const onConfirm = vi.fn();
  const user = userEvent.setup();
  render(
    <ClientDeleteDialog
      clientName="Клиент с объектами"
      error="Нельзя удалить клиента, пока к нему привязаны объекты"
      blockingSites={{
        count: 4,
        preview: [
          { id: "site-1", name: "Склад Север" },
          { id: "site-2", name: "Склад Юг" },
        ],
      }}
      isPending={false}
      onClose={vi.fn()}
      onConfirm={onConfirm}
      onViewSites={vi.fn()}
    />,
  );

  expect(
    screen.getByRole("alert").textContent,
  ).toBe("Нельзя удалить клиента, пока к нему привязаны объекты");
  expect(screen.getByText(/Клиент «Клиент с объектами»/)).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Удалить" }));
  expect(onConfirm).toHaveBeenCalledOnce();
  expect(screen.getByRole("alert")).toBeTruthy();
});

it("показывает количество и переводит к объектам клиента", async () => {
  const onViewSites = vi.fn();
  const user = userEvent.setup();
  render(
    <ClientDeleteDialog
      clientName="Клиент с объектами"
      error="Нельзя удалить клиента, пока к нему привязаны объекты"
      blockingSites={{
        count: 12,
        preview: [{ id: "site-1", name: "Склад Север" }],
      }}
      isPending={false}
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      onViewSites={onViewSites}
    />,
  );

  expect(screen.getByText("12").textContent).toBe("12");
  expect(screen.getByText("Склад Север")).toBeTruthy();
  await user.click(
    screen.getByRole("button", { name: "Перейти к объектам клиента" }),
  );
  expect(onViewSites).toHaveBeenCalledOnce();
});