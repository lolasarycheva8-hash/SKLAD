import { isDriverUser } from "./user-roles.ts";

export type MyDeliveriesActor = {
  id: string;
  role: string;
  isDriver: boolean;
  assignedSiteIds: string[] | null;
};

export function getMyDeliveriesAccess(
  user: MyDeliveriesActor | null | undefined,
): "driver" | "sites" | "none" {
  if (user && isDriverUser(user)) return "driver";
  return "none";
}