import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import type { Request } from "express";

import categoriesRouter from "./categories.ts";

function testUser(
  role: "admin" | "driver" | "logistician" | "manager",
  editableSections: string[] = [],
) {
  return {
    role,
    isDriver: role === "driver",
    editableSections,
  } as Request["appUser"];
}

async function requestAs(
  appUser: Request["appUser"],
  method: "POST" | "PATCH" | "DELETE",
): Promise<number> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.appUser = appUser;
    next();
  });
  app.use(categoriesRouter);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Test server did not bind to a TCP port");
  }

  try {
    const path =
      method === "POST"
        ? "/categories"
        : "/categories/00000000-0000-0000-0000-000000000000";
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "DELETE" ? undefined : JSON.stringify({}),
    });
    return response.status;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("категории не записываются логистиком с назначенным products", async () => {
  const logistician = testUser("logistician", ["products"]);

  for (const method of ["POST", "PATCH", "DELETE"] as const) {
    assert.equal(await requestAs(logistician, method), 403);
  }
});

test("категории не записываются менеджером или водителем", async () => {
  const manager = testUser("manager", ["products"]);
  const driver = testUser("driver", ["products"]);

  for (const user of [manager, driver]) {
    for (const method of ["POST", "PATCH", "DELETE"] as const) {
      assert.equal(await requestAs(user, method), 403);
    }
  }
});

test("администратор проходит guard записи категорий", async () => {
  const admin = testUser("admin");

  // The intentionally invalid body makes the create/rename handlers return
  // before touching the database, while the missing valid UUID exercises the
  // delete handler's normal not-found response.
  for (const method of ["POST", "PATCH", "DELETE"] as const) {
    assert.equal(await requestAs(admin, method), method === "DELETE" ? 404 : 400);
  }
});