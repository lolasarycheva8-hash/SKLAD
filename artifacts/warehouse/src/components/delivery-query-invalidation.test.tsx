import { expect, it, vi } from "vitest";

vi.mock("@workspace/api-client-react", () => ({
  getListDeliveriesQueryKey: () => ["deliveries"],
  getListDriversQueryKey: () => ["drivers"],
  getGetDeliveryDashboardSummaryQueryKey: () => ["delivery-dashboard"],
  getGetDashboardSummaryQueryKey: () => ["dashboard"],
  getListMyDeliveriesQueryKey: () => ["my-deliveries"],
}));

import { invalidateDeliveryWorkspaceQueries } from "@/lib/delivery-query-invalidation";

it("invalidates the deliveries prefix once and keeps dependent caches fresh", () => {
  const invalidateQueries = vi.fn();

  invalidateDeliveryWorkspaceQueries({ invalidateQueries } as never);

  expect(invalidateQueries).toHaveBeenCalledTimes(5);
  expect(invalidateQueries).toHaveBeenCalledWith({
    queryKey: ["deliveries"],
  });
  expect(
    invalidateQueries.mock.calls.filter(
      ([filters]) => filters.queryKey[0] === "deliveries",
    ),
  ).toHaveLength(1);
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["drivers"] });
  expect(invalidateQueries).toHaveBeenCalledWith({
    queryKey: ["delivery-dashboard"],
  });
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  expect(invalidateQueries).toHaveBeenCalledWith({
    queryKey: ["my-deliveries"],
  });
});