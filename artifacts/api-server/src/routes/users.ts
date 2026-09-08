import { Router, type IRouter } from "express";
import { eq, or, sql } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  db,
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
} from "@workspace/api-zod";
import { requireAdmin, requireAnySectionAccess } from "../middlewares/requirePermission";
import { normalizeUserRole } from "../lib/user-roles";

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

function toAppUserDto(
  row: Omit<typeof appUsersTable.$inferSelect, "legacyDriver">,
) {
  return {
    id: row.id,
    clerkUserId: row.clerkUserId,
    email: row.email,
    name: row.name,
    phone: row.phone,
    role: normalizeUserRole(row.role),
    editableSections: row.editableSections,
    assignedSiteIds: row.assignedSiteIds,
    createdAt: row.createdAt,
  };
}

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

  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(appUsersTable)
      .set({
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

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(UpdateUserRoleResponse.parse(toAppUserDto(updated)));
});

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
