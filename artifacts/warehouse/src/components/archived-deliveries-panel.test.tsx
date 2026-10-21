import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Delivery } from "@workspace/api-client-react";
import { ArchivedDeliveriesPanel } from "./archived-deliveries-panel";

vi.mock("wouter", () => ({
  Link: ({ children, href, className }: any) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const archivedDelivery: Delivery = {
  id: "delivery-1",
  siteId: "site-1",
  siteName: "Объект Альфа",
  siteAddress: "Адрес Альфа",
  driverUserId: "driver-1",
  driver: "Иван Водитель",
  plannedDate: "2024-05-10T00:00:00.000Z",
  correctedPlannedDate: null,
  deliveryType: null,
  scheduleMonth: "2024-05",
  actualDate: "2024-05-11T00:00:00.000Z",
  actApprovedAt: null,
  actApprovedBy: null,
  workflowStatus: "done",
  note: null,
  logisticianNote: null,
  status: "late",
  lagDays: 1,
  rescheduledFromDate: null,
  rescheduledBy: null,
  rescheduledAt: null,
  photosCount: 1,
  createdAt: "2024-05-01T00:00:00.000Z",
  archivedAt: "2024-05-20T12:00:00.000Z",
  archivedByName: "Логист",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ArchivedDeliveriesPanel", () => {
  it("shows archived delivery details and restores the selected row", () => {
    const onRestore = vi.fn();
    const onOpenPhotos = vi.fn();
    render(
      <ArchivedDeliveriesPanel
        data={[archivedDelivery]}
        search=""
        onSearchChange={vi.fn()}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onOpenPhotos={onOpenPhotos}
        onRestore={onRestore}
        restorePendingId={null}
        restoreError={null}
        onDismissRestoreError={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Объект Альфа").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Иван Водитель").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Логист").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Выполнена").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("button-archived-acts-delivery-1"));
    expect(onOpenPhotos).toHaveBeenCalledWith(archivedDelivery);
    fireEvent.click(screen.getByTestId("button-restore-delivery-delivery-1"));
    expect(onRestore).toHaveBeenCalledWith(archivedDelivery);
  });

  it("keeps search controlled and filters the archived rows", () => {
    const onSearchChange = vi.fn();
    render(
      <ArchivedDeliveriesPanel
        data={[archivedDelivery]}
        search=""
        onSearchChange={onSearchChange}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onOpenPhotos={vi.fn()}
        onRestore={vi.fn()}
        restorePendingId={null}
        restoreError={null}
        onDismissRestoreError={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId("input-search-deliveries-archived"), {
      target: { value: "неизвестный объект" },
    });
    expect(onSearchChange).toHaveBeenCalledWith("неизвестный объект");
  });

  it("provides loading, error retry, and empty states", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <ArchivedDeliveriesPanel
        data={[]}
        search=""
        onSearchChange={vi.fn()}
        isLoading={false}
        isError={true}
        onRetry={onRetry}
        onOpenPhotos={vi.fn()}
        onRestore={vi.fn()}
        restorePendingId={null}
        restoreError={null}
        onDismissRestoreError={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("button-retry-archived-deliveries"));
    expect(onRetry).toHaveBeenCalled();

    rerender(
      <ArchivedDeliveriesPanel
        data={[]}
        search=""
        onSearchChange={vi.fn()}
        isLoading={true}
        isError={false}
        onRetry={onRetry}
        onOpenPhotos={vi.fn()}
        onRestore={vi.fn()}
        restorePendingId={null}
        restoreError={null}
        onDismissRestoreError={vi.fn()}
      />,
    );
    expect(screen.getByTestId("archived-deliveries-loading")).toBeTruthy();

    rerender(
      <ArchivedDeliveriesPanel
        data={[]}
        search=""
        onSearchChange={vi.fn()}
        isLoading={false}
        isError={false}
        onRetry={onRetry}
        onOpenPhotos={vi.fn()}
        onRestore={vi.fn()}
        restorePendingId={null}
        restoreError={null}
        onDismissRestoreError={vi.fn()}
      />,
    );
    expect(screen.getByTestId("archived-deliveries-empty")).toBeTruthy();
  });
});