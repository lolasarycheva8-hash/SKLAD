import assert from "node:assert/strict";
import test from "node:test";
import { getMyDeliveriesAccess } from "./my-deliveries-access.ts";

test("активный водитель получает доступ по своему UUID", () => {
  assert.equal(
    getMyDeliveriesAccess({
      id: "driver-id",
      role: "driver",
      isDriver: false,
      assignedSiteIds: ["site-id"],
    }),
    "driver",
  );
});

test("руководитель с объектами не получает водительский список", () => {
  assert.equal(
    getMyDeliveriesAccess({
      id: "manager-id",
      role: "manager",
      isDriver: false,
      assignedSiteIds: ["site-id"],
    }),
    "none",
  );
});

test("деактивированный водитель не получает полевой доступ", () => {
  assert.equal(
    getMyDeliveriesAccess({
      id: "former-driver-id",
      role: "manager",
      isDriver: false,
      assignedSiteIds: ["assigned-site-id"],
    }),
    "none",
  );
});