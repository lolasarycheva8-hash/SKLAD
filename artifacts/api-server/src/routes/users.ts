import { Router, type IRouter } from "express";
import { and, eq, ne, or, sql } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  db,
  databaseForClient,
  pool,
  type PoolClient,
  appUsersTable,
  userInvitesTable,
  categoriesTable,
  productsTable,
  goodsReceiptsTable,
  goodsReceiptItemsTable,
  movementsTable,
  sitesTable,
  deliveriesTable,
  clientsTable,
  ordersTable,
  orderItemsTable,
  orderPaymentsTable,
  shipmentsTable,
  shipmentItemsTable,
} from "@workspace/db";
import {
  GetCurrentUserResponse,
  ListUsersResponse,
  UpdateUserRoleParams,
  UpdateUserRoleBody,
  UpdateUserRoleResponse,
  CreateUserBody,
  CreateUserResponse,
  ClearAllDataResponse,
  CreateUserImpersonationTokenParams,
  CreateUserImpersonationTokenResponse,
  CreateImpersonationReturnUrlResponse,
} from "@workspace/api-zod";
import { requireAdmin, requireAnySectionAccess } from "../middlewares/requirePermission";
import { toAppUserDto } from "../lib/app-user-dto";

const router: IRouter = Router();
export const publicUsersRouter: IRouter = Router();

const LEGACY_TECHNICAL_CLERK_USER_ID = "dev-bypass-user";

// Self-registration is only available to bootstrap a completely empty
// environment. Once the first real app user exists, admins create every
// employee account from the Users page.
publicUsersRouter.get(
  "/auth/registration-status",
  async (_req, res): Promise<void> => {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(appUsersTable)
      .where(
        sql`${appUsersTable.clerkUserId} <> ${LEGACY_TECHNICAL_CLERK_USER_ID}`,
      );

    res.json({ bootstrapRegistrationAllowed: count === 0 });
  },
);

router.get("/users/me", async (req, res): Promise<void> => {
  if (!req.appUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json(GetCurrentUserResponse.parse(toAppUserDto(req.appUser)));
});

router.get("/users", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(appUsersTable).orderBy(appUsersTable.createdAt);
  res.json(ListUsersResponse.parse(rows.map(toAppUserDto)));
});

router.get(
  "/drivers",
    requireAnySectionAccess(["deliveries", "sites", "orders", "shipments"]),
  async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: appUsersTable.id,
      name: appUsersTable.name,
      email: appUsersTable.email,
    })
    .from(appUsersTable)
    .where(
      or(
        eq(appUsersTable.role, "driver"),
        eq(appUsersTable.isDriver, true),
      ),
    )
    .orderBy(appUsersTable.name, appUsersTable.email);
  res.json(rows);
  },
);

router.patch("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateUserRoleParams.safeParse(req.params);
  const body = UpdateUserRoleBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const requestedEmail = body.data.email?.trim().toLowerCase();
  let replacedClerkEmail:
    | { clerkUserId: string; previousEmail: string }
    | undefined;
  let lockClient: PoolClient | undefined;
  let lockHeld = false;
  let discardLockClient = false;
  const operationState: { failureSource: "database" | "clerk" } = {
    failureSource: "database",
  };
  let updated: typeof appUsersTable.$inferSelect | undefined;

  try {
    lockClient = await pool.connect();
    try {
      await lockClient.query("SELECT pg_advisory_lock(hashtext($1))", [
        params.data.id,
      ]);
    } catch (lockErr) {
      // The server may have acquired a session lock even when the client did
      // not receive a successful response. Never return that session to pool.
      discardLockClient = true;
      throw lockErr;
    }
    lockHeld = true;

    const lockedDb = databaseForClient(lockClient);
    [updated] = await lockedDb.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(appUsersTable)
        .where(eq(appUsersTable.id, params.data.id));

      if (!current) return [];

      if (
        requestedEmail !== undefined &&
        requestedEmail !== current.email.toLowerCase()
      ) {
        const [emailOwner] = await tx
          .select({ id: appUsersTable.id })
          .from(appUsersTable)
          .where(
            and(
              sql`lower(${appUsersTable.email}) = ${requestedEmail}`,
              ne(appUsersTable.id, current.id),
            ),
          );

        if (emailOwner) {
          const conflict = new Error(
            "Пользователь с этой почтой уже зарегистрирован",
          );
          Object.assign(conflict, { statusCode: 409 });
          throw conflict;
        }

        try {
          await clerkClient.users.replaceUserEmailAddress(current.clerkUserId, {
            emailAddress: requestedEmail,
          });
        } catch (clerkErr) {
          // A network timeout can happen after Clerk has already applied the
          // change. Confirm the authoritative state before deciding to fail.
          try {
            const clerkUser = await clerkClient.users.getUser(
              current.clerkUserId,
            );
            const primaryEmail =
              clerkUser.emailAddresses.find(
                (address) => address.id === clerkUser.primaryEmailAddressId,
              )?.emailAddress ??
              clerkUser.emailAddresses[0]?.emailAddress ??
              "";
            if (primaryEmail.toLowerCase() !== requestedEmail) {
              operationState.failureSource = "clerk";
              throw clerkErr;
            }
          } catch (confirmationErr) {
            if (confirmationErr !== clerkErr) {
              req.log.warn(
                {
                  err: confirmationErr,
                  targetUserId: params.data.id,
                },
                "Failed to confirm Clerk email after replacement error",
              );
            }
            operationState.failureSource = "clerk";
            throw clerkErr;
          }
        }
        replacedClerkEmail = {
          clerkUserId: current.clerkUserId,
          previousEmail: current.email,
        };
      }

      const [row] = await tx
        .update(appUsersTable)
        .set({
          ...(requestedEmail !== undefined ? { email: requestedEmail } : {}),
          ...(body.data.name !== undefined ? { name: body.data.name } : {}),
          ...(body.data.phone !== undefined ? { phone: body.data.phone } : {}),
          isDriver: body.data.role === "driver",
          ...(body.data.assignedSiteIds !== undefined
            ? { assignedSiteIds: body.data.assignedSiteIds }
            : {}),
          role: body.data.role,
          editableSections:
            body.data.role === "logistician" || body.data.role === "manager"
              ? body.data.editableSections
              : [],
          updatedAt: new Date(),
        })
        .where(eq(appUsersTable.id, params.data.id))
        .returning();

      if (row && body.data.role !== "driver") {
        await tx
          .update(sitesTable)
          .set({ driverUserId: null })
          .where(eq(sitesTable.driverUserId, row.id));
        await tx
          .update(deliveriesTable)
          .set({ driverUserId: null })
          .where(eq(deliveriesTable.driverUserId, row.id));
        await tx
          .update(shipmentsTable)
          .set({ driverUserId: null })
          .where(eq(shipmentsTable.driverUserId, row.id));
      }
      return [row];
    });
  } catch (err: any) {
    if (replacedClerkEmail) {
      try {
        await clerkClient.users.replaceUserEmailAddress(
          replacedClerkEmail.clerkUserId,
          { emailAddress: replacedClerkEmail.previousEmail },
        );
      } catch (rollbackErr) {
        req.log.error(
          {
            err: rollbackErr,
            targetUserId: params.data.id,
          },
          "Failed to roll back Clerk email after user update failure",
        );
      }
    }

    const clerkCode: string | undefined = err?.errors?.[0]?.code;
    if (
      err?.statusCode === 409 ||
      clerkCode === "form_identifier_exists"
    ) {
      res.status(409).json({
        error: "Учётная запись с этой почтой уже существует",
      });
      return;
    }

    req.log.error(
      { err, targetUserId: params.data.id },
      "Failed to update user",
    );
    res.status(operationState.failureSource === "clerk" ? 502 : 500).json({
      error:
        err?.errors?.[0]?.message ??
        "Не удалось изменить пользователя. Повторите попытку",
    });
    return;
  } finally {
    if (lockClient) {
      if (lockHeld) {
        try {
          await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [
            params.data.id,
          ]);
        } catch (unlockErr) {
          discardLockClient = true;
          req.log.error(
            { err: unlockErr, targetUserId: params.data.id },
            "Failed to release user email update lock",
          );
        }
      }
      lockClient.release(discardLockClient);
    }
  }

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(UpdateUserRoleResponse.parse(toAppUserDto(updated)));
});

router.post(
  "/users/:id/impersonation-token",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = CreateUserImpersonationTokenParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (req.authActor) {
      res.status(409).json({ error: "Нельзя начать вложенный просмотр учётной записи" });
      return;
    }

    const [target] = await db
      .select()
      .from(appUsersTable)
      .where(eq(appUsersTable.id, params.data.id));
    if (!target) {
      res.status(404).json({ error: "Пользователь не найден" });
      return;
    }
    if (target.id === req.appUser?.id) {
      res.status(400).json({ error: "Вы уже вошли в эту учётную запись" });
      return;
    }

    try {
      const actorToken = await clerkClient.actorTokens.create({
        userId: target.clerkUserId,
        actor: { sub: req.appUser!.clerkUserId },
        expiresInSeconds: 300,
        sessionMaxDurationInSeconds: 1800,
      });
      if (!actorToken.token) {
        throw new Error("Clerk returned an actor token without a ticket");
      }
      req.log.info(
        { targetUserId: target.id },
        "Administrator created a user impersonation token",
      );
      res.set("Cache-Control", "no-store");
      res.json(
        CreateUserImpersonationTokenResponse.parse({
          token: actorToken.token,
        }),
      );
    } catch (err) {
      req.log.error(
        { err, targetUserId: target.id },
        "Failed to create Clerk actor token",
      );
      res.status(502).json({ error: "Не удалось войти в учётную запись пользователя" });
    }
  },
);

router.post(
  "/users/impersonation/return-url",
  async (req, res): Promise<void> => {
    if (!req.authActor) {
      res.status(403).json({ error: "Сессия просмотра не найдена" });
      return;
    }

    try {
      const signInToken = await clerkClient.signInTokens.createSignInToken({
        userId: req.authActor.clerkUserId,
        expiresInSeconds: 60,
      });
      if (!signInToken.token) {
        throw new Error("Clerk returned a sign-in token without a ticket");
      }
      req.log.info("Administrator requested return from user impersonation");
      res.set("Cache-Control", "no-store");
      res.json(
        CreateImpersonationReturnUrlResponse.parse({
          token: signInToken.token,
        }),
      );
    } catch (err) {
      req.log.error({ err }, "Failed to create administrator return token");
      res.status(502).json({ error: "Не удалось вернуться в учётную запись администратора" });
    }
  },
);

// Admin creates the account directly: sets e-mail (login), password and
// access rights. The user can sign in immediately — no e-mail invitation.
router.post("/users/create", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();

  const [existingUser] = await db
    .select({ id: appUsersTable.id })
    .from(appUsersTable)
    .where(sql`lower(${appUsersTable.email}) = ${email}`);
  if (existingUser) {
    res.status(409).json({ error: "Пользователь с этой почтой уже зарегистрирован" });
    return;
  }

  const name = parsed.data.name?.trim() || null;

  // Once a Clerk user exists, any later failure must delete it again so a
  // retry is possible (otherwise the e-mail is stuck taken in Clerk with no
  // app_users row, and requireAuth would keep rejecting the account).
  let clerkUserId: string | null = null;
  async function rollbackClerkUser() {
    if (!clerkUserId) return;
    try {
      await clerkClient.users.deleteUser(clerkUserId);
    } catch (cleanupErr) {
      req.log.error({ cleanupErr }, "Failed to roll back Clerk user");
    }
  }

  try {
    const clerkUser = await clerkClient.users.createUser({
      emailAddress: [email],
      password: parsed.data.password,
      ...(name ? { firstName: name } : {}),
      skipPasswordChecks: false,
    });
    clerkUserId = clerkUser.id;

    // The admin vouches for this address: mark it verified so the employee
    // can sign in with just email+password, without an e-mail code.
    const emailAddressId = clerkUser.emailAddresses[0]?.id;
    if (emailAddressId) {
      await clerkClient.emailAddresses.updateEmailAddress(emailAddressId, {
        verified: true,
      });
    }
  } catch (err: any) {
    const clerkMsg: string | undefined = err?.errors?.[0]?.message;
    const clerkCode: string | undefined = err?.errors?.[0]?.code;
    req.log.warn({ err, clerkCode }, "Clerk createUser/verify failed");
    await rollbackClerkUser();
    if (clerkCode === "form_identifier_exists") {
      res.status(409).json({ error: "Учётная запись с этой почтой уже существует" });
      return;
    }
    if (clerkCode?.startsWith("form_password")) {
      res.status(400).json({
        error:
          "Пароль не подходит: минимум 8 символов, и он не должен быть слишком простым или скомпрометированным",
      });
      return;
    }
    res.status(502).json({ error: clerkMsg || "Не удалось создать учётную запись" });
    return;
  }

  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(appUsersTable)
        .values({
          clerkUserId: clerkUserId!,
          email,
          name,
          role: parsed.data.role,
          editableSections:
            parsed.data.role === "logistician" || parsed.data.role === "manager"
              ? parsed.data.editableSections
              : [],
          isDriver: parsed.data.role === "driver",
        })
        .returning();

      // Clean up any leftover e-mail invite for this address.
      await tx
        .delete(userInvitesTable)
        .where(sql`lower(${userInvitesTable.email}) = ${email}`);

      return row;
    });

    req.log.info(
      { adminUserId: req.appUser?.id, createdUserId: created.id, email },
      "User account created by admin",
    );
    res.status(201).json(CreateUserResponse.parse(toAppUserDto(created)));
  } catch (err) {
    // Keep Clerk and our DB consistent: roll back the Clerk account.
    req.log.error({ err }, "DB insert failed after Clerk user creation; rolling back");
    await rollbackClerkUser();
    res.status(500).json({ error: "Не удалось создать пользователя" });
  }
});

router.post("/admin/clear-data", requireAdmin, async (req, res): Promise<void> => {
  try {
    await db.transaction(async (tx) => {
      // Children first to satisfy FK constraints.
      await tx.delete(shipmentItemsTable);
      await tx.delete(shipmentsTable);
      await tx.delete(orderPaymentsTable);
      await tx.delete(orderItemsTable);
      await tx.delete(ordersTable);
      await tx.delete(goodsReceiptItemsTable);
      await tx.delete(goodsReceiptsTable);
      await tx.delete(movementsTable);
      await tx.delete(deliveriesTable);
      await tx.delete(sitesTable);
      await tx.delete(productsTable);
      await tx.delete(categoriesTable);
      await tx.delete(clientsTable);
      // Some historical backups contain this non-login technical row.
      await tx
        .delete(appUsersTable)
        .where(eq(appUsersTable.clerkUserId, LEGACY_TECHNICAL_CLERK_USER_ID));
    });
    req.log.info(
      { adminUserId: req.appUser?.id, adminEmail: req.appUser?.email },
      "All business data cleared by admin",
    );
    res.json(ClearAllDataResponse.parse({ cleared: true }));
  } catch (err) {
    req.log.error({ err }, "Failed to clear all data");
    res.status(500).json({ error: "Не удалось очистить данные" });
  }
});

export default router;
