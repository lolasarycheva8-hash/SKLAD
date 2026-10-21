import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let assignments: any[] = [];

vi.mock("@workspace/api-client-react", () => ({
  getGetLegacyDriverAssignmentsQueryKey: () => ["legacy-driver-assignments"],
  getListSitesQueryKey: () => ["sites"],
  useGetLegacyDriverAssignments: () => ({
    data: assignments,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useListDrivers: () => ({
    data: [{ id: "driver-1", name: "Действующий водитель", email: "driver@example.com" }],
    isLoading: false,
    isError: false,
    error: null,
  }),
  useResolveLegacyDriverAssignments: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useSetLegacyDriverSimilarityReview: () => ({
    isPending: false,
    mutate: vi.fn(),
    variables: undefined,
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: () => null,
  AlertDialogAction: () => null,
  AlertDialogCancel: () => null,
  AlertDialogContent: () => null,
  AlertDialogDescription: () => null,
  AlertDialogFooter: () => null,
  AlertDialogHeader: () => null,
  AlertDialogTitle: () => null,
}));

import { LegacyDriverMappingDialog } from "./legacy-driver-mapping-dialog";

function reviewedAssignments({
  reviewerName,
  reviewerDeleted,
}: {
  reviewerName: string | null;
  reviewerDeleted: boolean;
}) {
  return ["Иванов И.И.", "Иванов Иван"].map((legacyName) => ({
    legacyName,
    siteCount: 1,
    deliveryCount: 0,
    totalCount: 1,
    similarityGroup: "ivanov",
    similarityReviewed: true,
    similarityReviewedAt: "2026-09-09T10:30:00.000Z",
    similarityReviewedByName: reviewerName,
    similarityReviewedByDeleted: reviewerDeleted,
  }));
}

describe("LegacyDriverMappingDialog — подпись автора проверки", () => {
  afterEach(cleanup);

  beforeEach(() => {
    assignments = [];
  });

  it("показывает имя действующего автора", () => {
    assignments = reviewedAssignments({
      reviewerName: "Мария Петрова",
      reviewerDeleted: false,
    });

    render(<LegacyDriverMappingDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByTestId("similarity-review-meta-ivanov").textContent).toContain(
      "Мария Петрова,",
    );
    expect(screen.getByTestId("similarity-review-meta-ivanov").textContent).not.toContain(
      "учётная запись удалена",
    );
  });

  it("показывает историческое имя и пометку удалённой учётной записи", () => {
    assignments = reviewedAssignments({
      reviewerName: "Удалённый Автор",
      reviewerDeleted: true,
    });

    render(<LegacyDriverMappingDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByTestId("similarity-review-meta-ivanov").textContent).toContain(
      "Удалённый Автор (учётная запись удалена),",
    );
  });

  it("показывает нейтральную подпись, если снимка имени нет", () => {
    assignments = reviewedAssignments({
      reviewerName: null,
      reviewerDeleted: true,
    });

    render(<LegacyDriverMappingDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByTestId("similarity-review-meta-ivanov").textContent).toContain(
      "администратор удалён,",
    );
  });

  it.each([
    ["similarityReviewedAt", "2026-09-09T11:30:00.000Z"],
    ["similarityReviewedAt", null],
    ["similarityReviewedByName", "Другой автор"],
    ["similarityReviewedByName", null],
    ["similarityReviewedByDeleted", true],
    ["similarityReviewed", false],
  ])("отклоняет противоречивое поле %s (%s) до показа группы", (field, value) => {
    assignments = reviewedAssignments({
      reviewerName: "Мария Петрова",
      reviewerDeleted: false,
    });
    // A later member must be checked even when another group separates the rows.
    assignments.splice(1, 0, { ...assignments[0], legacyName: "Другая группа", similarityGroup: "other" });
    assignments.push({ ...assignments[0], legacyName: "Иванов И.", [field]: value });

    render(<LegacyDriverMappingDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByTestId("mapping-error").textContent).toContain(
      "Получены противоречивые сведения о проверке группы совпадений",
    );
    expect(screen.queryByTestId("similarity-review-meta-ivanov")).toBeNull();
    expect(screen.queryByTestId("similarity-group-ivanov")).toBeNull();
    expect(screen.queryByTestId("button-review-similarity-group-ivanov")).toBeNull();
    expect((screen.getByTestId("button-apply-mapping") as HTMLButtonElement).disabled).toBe(true);
  });

  it("допускает разные подписи в разных группах и восстанавливается после корректного ответа", () => {
    const validAssignments = [
      ...reviewedAssignments({ reviewerName: "Первый автор", reviewerDeleted: false }),
      ...reviewedAssignments({ reviewerName: "Второй автор", reviewerDeleted: true }).map((item) => ({
        ...item,
        legacyName: `Другое ${item.legacyName}`,
        similarityGroup: "other",
        similarityReviewedAt: "2026-09-08T10:30:00.000Z",
      })),
    ];
    assignments = validAssignments.map((item, index) =>
      index === 1 ? { ...item, similarityReviewedByName: "Противоречивый автор" } : item,
    );
    const { rerender } = render(<LegacyDriverMappingDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByTestId("mapping-error")).toBeTruthy();

    assignments = validAssignments;
    rerender(<LegacyDriverMappingDialog open onOpenChange={vi.fn()} />);

    expect(screen.queryByTestId("mapping-error")).toBeNull();
    expect(screen.getByTestId("similarity-review-meta-ivanov").textContent).toContain("Первый автор,");
    expect(screen.getByTestId("similarity-review-meta-other").textContent).toContain(
      "Второй автор (учётная запись удалена),",
    );
  });
});