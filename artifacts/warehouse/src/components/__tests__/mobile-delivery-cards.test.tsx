import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MobileActualDateDialog, MobileLogisticianCard, MobileManagerTable } from "../mobile-delivery-cards";
import { confirmPlannedDate } from "@/lib/delivery-workspace";
import React from "react";

// mock the wouter Link to avoid router context errors
vi.mock("wouter", () => ({
  Link: ({ children, href, className }: any) => (
    <a href={href} className={className} data-testid="mock-link">
      {children}
    </a>
  ),
}));

it("shows an explicit empty state in the read-only mobile table", () => {
  const { unmount } = render(<MobileManagerTable data={[]} sitesWithoutDeliveries={[]} canEditCorrectedPlan={false} setDriverCommentTarget={vi.fn()} mobileDateFormat={new Intl.DateTimeFormat("ru-RU")} CorrectedPlanDateCell={() => null} />);
  expect(screen.getByText("Нет данных для отображения")).toBeTruthy();
  unmount();
});

describe("MobileActualDateDialog", () => {
  afterEach(() => {
    cleanup();
  });

  const mockDelivery: any = {
    id: "1",
    siteName: "Test Site",
    plannedDate: "2024-05-10T00:00:00.000Z",
    actualDate: null,
  };

  it("renders with correct month limits and empty draft when no actualDate", () => {
    render(
      <MobileActualDateDialog
        delivery={mockDelivery}
        month="2024-05"
        open={true}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />
    );
    
    const input = screen.getByTestId("mobile-dialog-input-actual-date-1") as HTMLInputElement;
    expect(input.min).toBe("2024-05-01");
    expect(input.max).toBe("2024-05-31");
    expect(input.value).toBe("");
  });

  it("shows confirm plan button when plannedDate exists and actualDate does not", () => {
    render(
      <MobileActualDateDialog
        delivery={mockDelivery}
        month="2024-05"
        open={true}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />
    );
    
    expect(screen.getByTestId("mobile-dialog-button-confirm-plan-1")).toBeTruthy();
  });

  it("handles save correctly when valid", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    
    render(
      <MobileActualDateDialog
        delivery={mockDelivery}
        month="2024-05"
        open={true}
        onOpenChange={onOpenChange}
        onSave={onSave}
      />
    );
    
    const input = screen.getByTestId("mobile-dialog-input-actual-date-1");
    fireEvent.change(input, { target: { value: "2024-05-15" } });
    
    const saveBtn = screen.getByTestId("mobile-dialog-button-save-1");
    fireEvent.click(saveBtn);
    
    expect(onSave).toHaveBeenCalledWith("2024-05-15");
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("disables save button if date is out of range or empty", () => {
    const onSave = vi.fn();
    render(
      <MobileActualDateDialog
        delivery={mockDelivery}
        month="2024-05"
        open={true}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />
    );
    
    const input = screen.getByTestId("mobile-dialog-input-actual-date-1");
    const saveBtn = screen.getByTestId("mobile-dialog-button-save-1");
    
    // initially empty, disabled
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
    
    // out of month, disabled
    fireEvent.change(input, { target: { value: "2024-06-01" } });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
    
    // within month, enabled
    fireEvent.change(input, { target: { value: "2024-05-05" } });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("has clear button only when actualDate exists", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    
    render(
      <MobileActualDateDialog
        delivery={{ ...mockDelivery, actualDate: "2024-05-10" }}
        month="2024-05"
        open={true}
        onOpenChange={onOpenChange}
        onSave={onSave}
      />
    );
    
    const clearBtn = screen.getByTestId("mobile-dialog-button-clear-1");
    expect(clearBtn).toBeTruthy();
    
    fireEvent.click(clearBtn);
    expect(onSave).toHaveBeenCalledWith("");
    
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});

describe("MobileLogisticianCard", () => {
  afterEach(() => {
    cleanup();
  });

  const mockDelivery: any = {
    id: "1",
    siteName: "Test Site",
    driver: "Ivan",
    plannedDate: "2024-05-10T00:00:00.000Z",
    actualDate: null,
    photosCount: 0,
    workflowStatus: "done",
    note: "Some note",
  };

  it("renders buttons correctly for logistician", () => {
    render(
      <MobileLogisticianCard
        delivery={mockDelivery}
        month="2024-05"
        onUpdateActualDate={vi.fn()}
        onOpenPhotos={vi.fn()}
        onOpenDriverComment={vi.fn()}
      />
    );
    
    expect(screen.getByTestId("mobile-card-button-fact-1")).toBeTruthy();
    expect(screen.getByTestId("mobile-card-button-acts-1")).toBeTruthy();
    expect(screen.getByTestId("mobile-card-button-comment-1")).toBeTruthy();
  });

  it("allows authorized fact correction for closed deliveries but blocks undated deliveries", () => {
    const { unmount } = render(
      <MobileLogisticianCard
        delivery={{ ...mockDelivery, workflowStatus: "closed" }}
        month="2024-05"
        onUpdateActualDate={vi.fn()}
        onOpenPhotos={vi.fn()}
        onOpenDriverComment={vi.fn()}
      />
    );
    
    let btn = screen.getByTestId("mobile-card-button-fact-1");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    
    unmount();
    
    render(
      <MobileLogisticianCard
        delivery={{ ...mockDelivery, workflowStatus: "done", plannedDate: null }}
        month="2024-05"
        onUpdateActualDate={vi.fn()}
        onOpenPhotos={vi.fn()}
        onOpenDriverComment={vi.fn()}
      />
    );
    btn = screen.getByTestId("mobile-card-button-fact-1");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables acts button if actualDate is missing", () => {
    render(
      <MobileLogisticianCard
        delivery={{ ...mockDelivery, actualDate: null }}
        month="2024-05"
        onUpdateActualDate={vi.fn()}
        onOpenPhotos={vi.fn()}
        onOpenDriverComment={vi.fn()}
      />
    );
    
    const btn = screen.getByTestId("mobile-card-button-acts-1");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables acts button if actualDate is present", () => {
    render(
      <MobileLogisticianCard
        delivery={{ ...mockDelivery, actualDate: "2024-05-15" }}
        month="2024-05"
        onUpdateActualDate={vi.fn()}
        onOpenPhotos={vi.fn()}
        onOpenDriverComment={vi.fn()}
      />
    );
    
    const btn = screen.getByTestId("mobile-card-button-acts-1");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });
});
