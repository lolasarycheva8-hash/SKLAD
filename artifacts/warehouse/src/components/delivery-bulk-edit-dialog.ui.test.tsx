import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  mutate: vi.fn(),
  behavior: "success" as "success" | "error",
}));

vi.mock("@workspace/api-client-react", () => ({
  useUpdateDeliveriesBulk: (options: {
    mutation: {
      onSuccess: (result: { updated: number }) => void;
      onError: (error: Error) => void;
    };
  }) => ({
    isPending: false,
    mutate: (input: unknown) => {
      api.mutate(input);
      if (api.behavior === "error") {
        options.mutation.onError(new Error("Конфликт данных на сервере"));
      } else {
        options.mutation.onSuccess({ updated: 1 });
      }
    },
  }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
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

vi.mock("@/components/ui/select", () => {
  const Item = ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => <option value={value}>{children}</option>;
  const Trigger = ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>;
  const Content = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );
  const Value = () => null;

  function collect(
    node: React.ReactNode,
    options: React.ReactElement[],
    metadata: { testId?: string },
  ) {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      if (child.type === Item) {
        options.push(child);
        return;
      }
      if (child.type === Trigger) {
        metadata.testId = (
          child.props as { "data-testid"?: string }
        )["data-testid"];
      }
      collect(
        (child.props as { children?: React.ReactNode }).children,
        options,
        metadata,
      );
    });
  }

  const Select = ({
    value,
    onValueChange,
    children,
    disabled,
  }: {
    value?: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
    disabled?: boolean;
  }) => {
    const options: React.ReactElement[] = [];
    const metadata: { testId?: string } = {};
    collect(children, options, metadata);
    return (
      <select
        data-testid={metadata.testId}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {!value && <option value="">Выберите</option>}
        {options}
      </select>
    );
  };

  return {
    Select,
    SelectContent: Content,
    SelectItem: Item,
    SelectTrigger: Trigger,
    SelectValue: Value,
  };
});

import {
  DeliveryBulkEditDialog,
  type BulkDeliveryRow,
} from "./delivery-bulk-edit-dialog";

function delivery(): BulkDeliveryRow {
  return {
    id: "delivery-one",
    siteId: "site-one",
    siteBranch: "Север",
    driverUserId: null,
    plannedDate: null,
    actualDate: null,
    workflowStatus: "active",
    parentDeliveryId: null,
  } as unknown as BulkDeliveryRow;
}

function renderDialog(overrides: {
  onOpenChange?: (open: boolean) => void;
  onSuccess?: (updated: number) => void;
} = {}) {
  return render(
    <DeliveryBulkEditDialog
      open
      onOpenChange={overrides.onOpenChange ?? vi.fn()}
      rows={[delivery()]}
      drivers={[{ id: "driver-new", name: "Новый водитель", email: "new@test.ru" }]}
      monthLabel="март 2026"
      monthMin="2026-03-01"
      monthMax="2026-03-31"
      branchLabel="Север"
      onSuccess={overrides.onSuccess ?? vi.fn()}
    />,
  );
}

describe("DeliveryBulkEditDialog", () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.mutate.mockReset();
    api.behavior = "success";
  });

  it("supports cancel and confirms the selected driver change", () => {
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    renderDialog({ onOpenChange, onSuccess });

    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.change(screen.getByTestId("bulk-driver"), {
      target: { value: "driver-new" },
    });
    fireEvent.click(screen.getByTestId("bulk-confirm"));

    expect(api.mutate).toHaveBeenCalledWith({
      data: {
        deliveries: [
          {
            id: "delivery-one",
            expectedDriverUserId: null,
            expectedPlannedDate: null,
          },
        ],
        driverUserId: "driver-new",
      },
    });
    expect(onSuccess).toHaveBeenCalledWith(1);
  });

  it("keeps the dialog open and shows a server error", () => {
    api.behavior = "error";
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });

    fireEvent.change(screen.getByTestId("bulk-driver"), {
      target: { value: "driver-new" },
    });
    fireEvent.click(screen.getByTestId("bulk-confirm"));

    expect(screen.getByTestId("bulk-error").textContent).toContain(
      "Конфликт данных на сервере",
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Массовое изменение доставок" }),
    ).toBeTruthy();
  });
});