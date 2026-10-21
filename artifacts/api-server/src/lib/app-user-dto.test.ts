import assert from "node:assert/strict";
import test from "node:test";
import { GetCurrentUserResponse } from "../../../../lib/api-zod/src/generated/api.ts";

import { toAppUserDto } from "./app-user-dto.ts";

const baseUser = {
  id: "11111111-1111-4111-8111-111111111111",
  clerkUserId: "clerk-user",
  email: "user@example.com",
  name: "Пользователь",
  phone: null,
  editableSections: [],
  assignedSiteIds: null,
  createdAt: new Date("2026-09-09T00:00:00.000Z"),
  updatedAt: new Date("2026-09-09T00:00:00.000Z"),
};

test("current-user response preserves the legacy driver flag", () => {
  const response = GetCurrentUserResponse.parse(
    toAppUserDto({
      ...baseUser,
      role: "viewer",
      isDriver: true,
    }),
  );

  assert.equal(response.role, "manager");
  assert.equal(response.isDriver, true);
});

test("current-user response marks an ordinary user as not a driver", () => {
  const response = GetCurrentUserResponse.parse(
    toAppUserDto({
      ...baseUser,
      role: "viewer",
      isDriver: false,
    }),
  );

  assert.equal(response.role, "manager");
  assert.equal(response.isDriver, false);
});