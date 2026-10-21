import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";

import {
  requireAdmin,
  requireAnySectionAccess,
  requireDriver,
  requireOrderProductLookup,
  requirePermission,
  requireSectionAccess,
} from "./requirePermission.ts";

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

function runMiddleware(
  middleware: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => void,
  appUser: Request["appUser"],
) {
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

  middleware(
    { appUser } as Request,
    response,
    (() => {
      nextCalled = true;
    }) as NextFunction,
  );

  return { nextCalled, statusCode, responseBody };
}

function testUser(
  role: "admin" | "driver" | "logistician" | "manager",
  editableSections: string[] = [],
  isDriver = false,
) {
  return {
    role,
    isDriver,
    editableSections,
  } as Request["appUser"];
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

test("обе логистические роли получают продукты и заказы без назначенных разделов", () => {
  const logistician = testUser("logistician");
  const manager = testUser("manager");

  for (const user of [logistician, manager]) {
    assert.equal(runMiddleware(requireSectionAccess("products"), user).nextCalled, true);
    assert.equal(runMiddleware(requireSectionAccess("orders"), user).nextCalled, true);
    assert.equal(
      runMiddleware(requireAnySectionAccess(["orders", "sites"]), user).nextCalled,
      true,
    );
    assert.equal(runMiddleware(requirePermission("products"), user).nextCalled, true);
    assert.equal(runMiddleware(requirePermission("orders"), user).nextCalled, true);
    assert.equal(runMiddleware(requireOrderProductLookup, user).nextCalled, true);
  }
});

test("водитель не получает логистические defaults", () => {
  const driver = testUser("driver", ["products", "orders"]);

  assert.equal(
    runMiddleware(requireSectionAccess("products"), driver).nextCalled,
    false,
  );
  assert.equal(
    runMiddleware(requireOrderProductLookup, driver).nextCalled,
    false,
  );
});

test("другие разделы обе логистические роли получают только по назначению", () => {
  for (const role of ["logistician", "manager"] as const) {
    const withoutSites = testUser(role);
    const withSites = testUser(role, ["sites"]);
    assert.equal(runMiddleware(requireSectionAccess("sites"), withoutSites).nextCalled, false);
    assert.equal(runMiddleware(requirePermission("sites"), withoutSites).nextCalled, false);
    assert.equal(runMiddleware(requireSectionAccess("sites"), withSites).nextCalled, true);
    assert.equal(runMiddleware(requirePermission("sites"), withSites).nextCalled, true);
  }
});

test("поиск товаров заказа сохраняет запрет для legacy-водителя", () => {
  const legacyDriver = testUser("logistician", [], true);

  assert.deepEqual(runMiddleware(requireOrderProductLookup, legacyDriver), {
    nextCalled: false,
    statusCode: 403,
    responseBody: { error: "Раздел недоступен" },
  });
});

test("requireAdmin разрешает записи категорий только администратору", () => {
  assert.equal(
    runMiddleware(requireAdmin, testUser("logistician", ["products"])).nextCalled,
    false,
  );
  assert.equal(
    runMiddleware(requireAdmin, testUser("manager", ["products"])).nextCalled,
    false,
  );
  assert.equal(runMiddleware(requireAdmin, testUser("admin")).nextCalled, true);
});