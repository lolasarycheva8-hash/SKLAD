import type { QueryClient } from "@tanstack/react-query";
import {
  getGetDashboardSummaryQueryKey,
  getGetDeliveryDashboardSummaryQueryKey,
  getListDeliveriesQueryKey,
  getListDriversQueryKey,
  getListMyDeliveriesQueryKey,
} from "@workspace/api-client-react";

export function invalidateDeliveryWorkspaceQueries(
  queryClient: Pick<QueryClient, "invalidateQueries">,
) {
  // This prefix covers every month and archive state. Exact month keys must
  // not be invalidated again because active matches would refetch twice.
  queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
  queryClient.invalidateQueries({ queryKey: getListDriversQueryKey() });
  queryClient.invalidateQueries({
    queryKey: getGetDeliveryDashboardSummaryQueryKey(),
  });
  queryClient.invalidateQueries({
    queryKey: getGetDashboardSummaryQueryKey(),
  });
  queryClient.invalidateQueries({
    queryKey: getListMyDeliveriesQueryKey(),
  });
}