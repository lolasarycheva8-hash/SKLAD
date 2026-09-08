const longToken = "безпробелов".repeat(28);

export const ownDelivery = {
  id: "browser-own-delivery",
  siteId: "browser-site",
  siteName: `Свой-объект-${longToken}`,
  siteAddress: `Адрес-${longToken}`,
  driverUserId: "browser-driver",
  driver: "Мобильный водитель",
  plannedDate: new Date().toLocaleDateString("en-CA"),
  actualDate: null,
  note: `Примечание-${longToken}`,
  photosCount: 0,
  actApprovedAt: null,
  actApprovedBy: null,
  workflowStatus: "planned",
};

export function useListMyDeliveries() {
  return { data: [ownDelivery], isLoading: false };
}

export function useMarkMyDeliveryDone() {
  return { isPending: false, mutate() {} };
}

export function getListMyDeliveriesQueryKey() {
  return ["my-deliveries"];
}