import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import { appUsersTable, db, pool } from "@workspace/db";
import { clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import express from "express";

import type { AuthenticatedAppUser } from "./user-roles.ts";
import usersRouter from "../routes/users.ts";

function testUser(role: AuthenticatedAppUser["role"]): AuthenticatedAppUser {
  const now = new Date();
  return {
    id: randomUUID(),
    clerkUserId: `test-${randomUUID()}`,
    email: `test-${randomUUID()}@example.test`,
    name: "Тестовый пользователь",
    phone: null,
    role,
    editableSections: [],
    isDriver: false,
    assignedSiteIds: null,
    createdAt: now,
    updatedAt: now,
  };
}

const admin = testUser("admin");
const viewer = testUser("manager");
let actor: AuthenticatedAppUser = admin;
let authActor: AuthenticatedAppUser | undefined;
let baseUrl = "";
let createdActorTokenParams: Record<string, unknown> | null = null;
const logEntries: unknown[] = [];

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.appUser = actor;
  req.authActor = authActor;
  req.log = {
    info(...args: unknown[]) {
      logEntries.push(args);
    },
    error(...args: unknown[]) {
      logEntries.push(args);
    },
  } as unknown as typeof req.log;
  next();
});
app.use(usersRouter);

const server = app.listen(0);
const originalCreateActorToken = clerkClient.actorTokens.create;

before(async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Integration tests must not run against production");
  }

  await db.insert(appUsersTable).values([admin, viewer]);
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  clerkClient.actorTokens.create = (async (
    params: Parameters<typeof originalCreateActorToken>[0],
  ) => {
    createdActorTokenParams = params;
    return {
      id: "actor_token_test",
      token: "one-time-secret-ticket",
      url: "https://example.test/ticket",
    } as Awaited<ReturnType<typeof originalCreateActorToken>>;
  }) as typeof clerkClient.actorTokens.create;
});

after(async () => {
  clerkClient.actorTokens.create = originalCreateActorToken;
  await db.delete(appUsersTable).where(eq(appUsersTable.id, viewer.id));
  await db.delete(appUsersTable).where(eq(appUsersTable.id, admin.id));
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await pool.end();
});

async function createActorToken(targetId: string) {
  return fetch(`${baseUrl}/users/${targetId}/impersonation-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
}

test("non-admin cannot create an impersonation token", async () => {
  actor = viewer;
  const response = await createActorToken(admin.id);
  assert.equal(response.status, 403);
});

test("missing target returns 404", async () => {
  actor = admin;
  const response = await createActorToken(randomUUID());
  assert.equal(response.status, 404);
});

test("administrator cannot impersonate self", async () => {
  const response = await createActorToken(admin.id);
  assert.equal(response.status, 400);
});

test("nested impersonation is rejected", async () => {
  authActor = admin;
  const response = await createActorToken(viewer.id);
  authActor = undefined;
  assert.equal(response.status, 409);
});

test("actor token is short-lived and never logged", async () => {
  logEntries.length = 0;
  const response = await createActorToken(viewer.id);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { token: "one-time-secret-ticket" });
  assert.deepEqual(createdActorTokenParams, {
    userId: viewer.clerkUserId,
    actor: { sub: admin.clerkUserId },
    expiresInSeconds: 300,
    sessionMaxDurationInSeconds: 1800,
  });
  assert.doesNotMatch(JSON.stringify(logEntries), /one-time-secret-ticket/);
});