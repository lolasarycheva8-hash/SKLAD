import assert from "node:assert/strict";
import test from "node:test";
import { isDriverUser } from "./drivers.ts";

test("driver role is eligible for driver assignment", () => {
  assert.equal(isDriverUser({ role: "driver", isDriver: false }), true);
});

test("isDriver flag is eligible for driver assignment", () => {
  assert.equal(isDriverUser({ role: "viewer", isDriver: true }), true);
});

test("ordinary user is not eligible for driver assignment", () => {
  assert.equal(isDriverUser({ role: "viewer", isDriver: false }), false);
});