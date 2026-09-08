export type MyDeliveriesActor = {
  id: string;
  role: string;
  isDriver: boolean;
  assignedSiteIds: string[] | null;
};

export function getMyDeliveriesAccess(
  user: MyDeliveriesActor | null | undefined,
): "driver" | "sites" | "none" {
  if (user?.role === "driver" || user?.isDriver) return "driver";
  return "none";
}