import type { NextFunction, Request, Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { eq, sql } from "drizzle-orm";
import { db, appUsersTable, userInvitesTable } from "@workspace/db";
import {
  normalizeAppUser,
  normalizeInvitedUserRole,
  type AuthenticatedAppUser,
} from "../lib/user-roles";

class NotInvitedError extends Error {}

// Old backups and checkpoints may still contain this non-login technical row.
// It never authenticates a request; excluding it only preserves first-user
// recovery until every historical database copy has been replaced.
const LEGACY_TECHNICAL_CLERK_USER_ID = "dev-bypass-user";

declare global {
  namespace Express {
    interface Request {
      appUser?: AuthenticatedAppUser;
    }
  }
}

async function provisionAppUser(clerkUserId: string): Promise<AuthenticatedAppUser> {
  const [existing] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.clerkUserId, clerkUserId));

  if (existing) {
    return normalizeAppUser(existing);
  }

  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email = clerkUser.emailAddresses.find(
    (e) => e.id === clerkUser.primaryEmailAddressId,
  )?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress ?? "";
  const name =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;

  // All checks and the insert run in one transaction under an advisory lock
  // so that (a) exactly one account can ever win the first-user auto-admin
  // promotion, and (b) an invite deleted concurrently cannot still be used.
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(783201)`);

    // Another initial request for this Clerk session may have provisioned the
    // same user while this transaction was waiting for the advisory lock.
    const [concurrentlyCreated] = await tx
      .select()
      .from(appUsersTable)
      .where(eq(appUsersTable.clerkUserId, clerkUserId));
    if (concurrentlyCreated) {
      return normalizeAppUser(concurrentlyCreated);
    }

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(appUsersTable)
      .where(
        sql`${appUsersTable.clerkUserId} <> ${LEGACY_TECHNICAL_CLERK_USER_ID}`,
      );
    const isFirstUser = count === 0;

    // Closed registration: everyone after the first user must have a pending
    // invitation; the invite defines their role/sections/driver.
    const [invite] = await tx
      .select()
      .from(userInvitesTable)
      .where(sql`lower(${userInvitesTable.email}) = lower(${email})`);

    if (!isFirstUser && !invite) {
      throw new NotInvitedError(email);
    }

    const invitedRole = invite
      ? normalizeInvitedUserRole(invite.role, invite.isDriver)
      : null;
    const [row] = await tx
      .insert(appUsersTable)
      .values({
        clerkUserId,
        email,
        name,
        role: isFirstUser ? "admin" : invitedRole!,
        editableSections: isFirstUser ? [] : invite!.editableSections,
        isDriver: isFirstUser ? false : invitedRole === "driver",
      })
      .onConflictDoNothing({ target: appUsersTable.clerkUserId })
      .returning();

    if (row && invite && !invite.acceptedAt) {
      await tx
        .update(userInvitesTable)
        .set({ acceptedAt: new Date() })
        .where(eq(userInvitesTable.id, invite.id));
    }
    return row ? normalizeAppUser(row) : undefined;
  });

  if (created) {
    return created;
  }

  // Concurrent request already inserted it; fetch it.
  const [row] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.clerkUserId, clerkUserId));
  return normalizeAppUser(row);
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  const userId = (auth?.sessionClaims?.userId as string | undefined) || auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    req.appUser = await provisionAppUser(userId);
  } catch (err) {
    if (err instanceof NotInvitedError) {
      res.status(403).json({
        error: "Доступ только по приглашению. Обратитесь к администратору.",
        code: "NOT_INVITED",
      });
      return;
    }
    req.log?.error({ err }, "Failed to provision app user");
    res.status(500).json({ error: "Failed to resolve user" });
    return;
  }

  next();
}
