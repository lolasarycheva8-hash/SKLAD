import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import { clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import express from "express";
import { appUsersTable, db, pool } from "@workspace/db";

import type { AuthenticatedAppUser } from "./user-roles.ts";
import usersRouter from "../routes/users.ts";

function testUser(
  role: AuthenticatedAppUser["role"],
  email = `test-${randomUUID()}@example.test`,
): AuthenticatedAppUser {
  const now = new Date();
  return {
    id: randomUUID(),
    clerkUserId: `test-${randomUUID()}`,
    email,
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
let baseUrl = "";
const createdUserIds = [admin.id];
const originalReplaceUserEmailAddress =
  clerkClient.users.replaceUserEmailAddress;
const originalGetUser = clerkClient.users.getUser;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.appUser = admin;
  req.log = {
    info() {},
    error() {},
    warn() {},
  } as unknown as typeof req.log;
  next();
});
app.use(usersRouter);

const server = app.listen(0);

before(async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Integration tests must not run against production");
  }

  await db.insert(appUsersTable).values(admin);
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  clerkClient.users.replaceUserEmailAddress = originalReplaceUserEmailAddress;
  clerkClient.users.getUser = originalGetUser;
  await db
    .delete(appUsersTable)
    .where(eq(appUsersTable.id, admin.id));
  for (const id of createdUserIds.slice(1)) {
    await db.delete(appUsersTable).where(eq(appUsersTable.id, id));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await pool.end();
});

async function createUser(user: AuthenticatedAppUser) {
  createdUserIds.push(user.id);
  await db.insert(appUsersTable).values(user);
}

async function patchUser(id: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/users/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      role: "manager",
      editableSections: [],
      ...body,
    }),
  });
}

test("lowercases the email in Clerk and the database", async () => {
  const user = testUser("manager", "before@example.test");
  await createUser(user);
  const calls: Array<{ userId: string; emailAddress: string }> = [];
  clerkClient.users.replaceUserEmailAddress = (async (userId, params) => {
    calls.push({ userId, emailAddress: params.emailAddress });
    return {} as Awaited<
      ReturnType<typeof originalReplaceUserEmailAddress>
    >;
  }) as typeof clerkClient.users.replaceUserEmailAddress;

  const response = await patchUser(user.id, {
    email: "New-Address@Example.TEST",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    { userId: user.clerkUserId, emailAddress: "new-address@example.test" },
  ]);
  const [stored] = await db
    .select({ email: appUsersTable.email })
    .from(appUsersTable)
    .where(eq(appUsersTable.id, user.id));
  assert.equal(stored?.email, "new-address@example.test");
});

test("commits when Clerk confirms an ambiguous replacement succeeded", async () => {
  const user = testUser("manager", "ambiguous-before@example.test");
  await createUser(user);
  const requestedEmail = "ambiguous-after@example.test";
  const replaceCalls: Array<{ userId: string; emailAddress: string }> = [];
  const getUserCalls: string[] = [];
  clerkClient.users.replaceUserEmailAddress = (async (userId, params) => {
    replaceCalls.push({ userId, emailAddress: params.emailAddress });
    throw new Error("Connection closed after Clerk accepted the replacement");
  }) as typeof clerkClient.users.replaceUserEmailAddress;
  clerkClient.users.getUser = (async (userId) => {
    getUserCalls.push(userId);
    return {
      primaryEmailAddressId: "email_address_after",
      emailAddresses: [
        {
          id: "email_address_after",
          emailAddress: requestedEmail,
        },
      ],
    } as Awaited<ReturnType<typeof originalGetUser>>;
  }) as typeof clerkClient.users.getUser;

  const response = await patchUser(user.id, {
    email: "Ambiguous-After@Example.TEST",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(replaceCalls, [
    { userId: user.clerkUserId, emailAddress: requestedEmail },
  ]);
  assert.deepEqual(getUserCalls, [user.clerkUserId]);
  const [stored] = await db
    .select({ email: appUsersTable.email })
    .from(appUsersTable)
    .where(eq(appUsersTable.id, user.id));
  assert.equal(stored?.email, requestedEmail);
});

test("rejects a case-insensitive duplicate without calling Clerk", async () => {
  const user = testUser("manager", "unique-target@example.test");
  const duplicate = testUser("manager", "Existing@Example.test");
  await createUser(user);
  await createUser(duplicate);
  let clerkCalls = 0;
  clerkClient.users.replaceUserEmailAddress = (async () => {
    clerkCalls += 1;
    throw new Error("Clerk must not be called for a database duplicate");
  }) as typeof clerkClient.users.replaceUserEmailAddress;

  const response = await patchUser(user.id, {
    email: "existing@EXAMPLE.TEST",
  });

  assert.equal(response.status, 409);
  assert.equal(clerkCalls, 0);
  const [stored] = await db
    .select({ email: appUsersTable.email })
    .from(appUsersTable)
    .where(eq(appUsersTable.id, user.id));
  assert.equal(stored?.email, user.email);
});

test("restores the old Clerk email when the database update fails", async () => {
  const user = testUser("manager", "rollback-target@example.test");
  await createUser(user);
  const calls: Array<{ userId: string; emailAddress: string }> = [];
  clerkClient.users.replaceUserEmailAddress = (async (userId, params) => {
    calls.push({ userId, emailAddress: params.emailAddress });
    return {} as Awaited<
      ReturnType<typeof originalReplaceUserEmailAddress>
    >;
  }) as typeof clerkClient.users.replaceUserEmailAddress;

  const response = await patchUser(user.id, {
    email: "replacement@example.test",
    assignedSiteIds: ["not-a-uuid"],
  });

  assert.equal(response.status, 500);
  assert.deepEqual(calls, [
    { userId: user.clerkUserId, emailAddress: "replacement@example.test" },
    { userId: user.clerkUserId, emailAddress: user.email },
  ]);
  const [stored] = await db
    .select({ email: appUsersTable.email })
    .from(appUsersTable)
    .where(eq(appUsersTable.id, user.id));
  assert.equal(stored?.email, user.email);
});