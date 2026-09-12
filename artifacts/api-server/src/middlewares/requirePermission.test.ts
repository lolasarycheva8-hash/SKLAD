import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";

import { requireDriver } from "./requirePermission.ts";

function runRequireDriver(appUser: Request["appUser"]) {
  let nextCalled = false;
  let statusCode: number | undefined;
  let responseBody: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(body: unknown) {
      responseBody = body;
      return response;
    },
  } as unknown as Response;

  requireDriver(
    { appUser } as Request,
    response,
    (() => {
      nextCalled = true;
    }) as NextFunction,
  );

  return { nextCalled, statusCode, responseBody };
}

test("защищённый маршрут одинаково принимает роль и legacy-флаг водителя", () => {
  const roleDriver = runRequireDriver({
    role: "driver",
    isDriver: false,
  } as Request["appUser"]);
  const legacyDriver = runRequireDriver({
    role: "manager",
    isDriver: true,
  } as Request["appUser"]);

  assert.equal(roleDriver.nextCalled, true);
  assert.equal(roleDriver.statusCode, undefined);
  assert.equal(legacyDriver.nextCalled, true);
  assert.equal(legacyDriver.statusCode, undefined);
});

test("защищённый маршрут отклоняет обычного пользователя", () => {
  assert.deepEqual(
    runRequireDriver({
      role: "manager",
      isDriver: false,
    } as Request["appUser"]),
    {
      nextCalled: false,
      statusCode: 403,
      responseBody: { error: "Требуется роль водителя" },
    },
  );
});