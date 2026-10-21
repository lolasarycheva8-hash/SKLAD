import type { AppUser } from "@workspace/db";

import { normalizeUserRole } from "./user-roles.ts";

export function toAppUserDto(
  row: Omit<AppUser, "legacyDriver">,
) {
  return {
    id: row.id,
    clerkUserId: row.clerkUserId,
    email: row.email,
    name: row.name,
    phone: row.phone,
    role: normalizeUserRole(row.role),
    isDriver: row.isDriver,
    editableSections: row.editableSections,
    assignedSiteIds: row.assignedSiteIds,
    createdAt: row.createdAt,
  };
}