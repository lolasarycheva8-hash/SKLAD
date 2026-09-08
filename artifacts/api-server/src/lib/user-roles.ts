import type { AppUser } from "@workspace/db";
import type { UserRole } from "@workspace/api-zod";

export type AuthenticatedAppUser = Omit<AppUser, "role" | "legacyDriver"> & {
  role: UserRole;
};

export function normalizeUserRole(role: AppUser["role"]): UserRole {
  switch (role) {
    case "editor":
      return "logistician";
    case "viewer":
      return "manager";
    case "admin":
    case "driver":
    case "logistician":
    case "manager":
      return role;
  }
}

export function normalizeInvitedUserRole(
  role: AppUser["role"],
  isDriver: boolean,
): UserRole {
  return isDriver ? "driver" : normalizeUserRole(role);
}

export function normalizeAppUser(user: AppUser): AuthenticatedAppUser {
  const { legacyDriver: _legacyDriver, ...appUser } = user;
  return {
    ...appUser,
    role: normalizeUserRole(user.role),
  };
}