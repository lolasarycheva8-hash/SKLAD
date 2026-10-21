import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanupHealth: {
    lastRunAt: "2026-09-09T08:00:00.000Z",
    lastSuccessfulRunAt: "2026-09-09T06:00:00.000Z",
    status: "failed",
    failureKind: "list_timeout",
    consecutiveFailures: 2,
    hasRepeatedFailures: true,
    summary: null,
    staleAfterHours: 24,
    isStale: false,
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetDeliveryUploadCleanupHealthQueryKey: () => [
    "audit",
    "delivery-upload-cleanup",
  ],
  useGetDeliveryUploadCleanupHealth: () => ({ data: mocks.cleanupHealth }),
  useListAuditLog: () => ({
    data: { items: [], total: 0 },
    isLoading: false,
    isError: false,
  }),
}));

import Audit from "@/pages/audit";

describe("Audit cleanup health warning", () => {
  afterEach(cleanup);

  it("показывает безопасное раннее предупреждение и скрывает его после успеха", () => {
    const { rerender } = render(<Audit />);

    const warning = screen.getByTestId(
      "alert-delivery-upload-cleanup-failures",
    );
    expect(warning.textContent).toContain("Неудачных попыток подряд: 2");
    expect(warning.textContent).toContain(
      "Хранилище не успело вернуть список файлов",
    );
    expect(warning.textContent).not.toContain("/");
    expect(
      screen.queryByTestId("alert-delivery-upload-cleanup"),
    ).toBeNull();

    mocks.cleanupHealth.status = "success";
    mocks.cleanupHealth.failureKind = "none";
    mocks.cleanupHealth.consecutiveFailures = 0;
    mocks.cleanupHealth.hasRepeatedFailures = false;
    rerender(<Audit />);

    expect(
      screen.queryByTestId("alert-delivery-upload-cleanup-failures"),
    ).toBeNull();
  });
});