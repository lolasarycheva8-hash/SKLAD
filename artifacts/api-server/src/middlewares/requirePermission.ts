import type { NextFunction, Request, Response } from "express";
import type { Section } from "@workspace/db";
import { isDriverUser } from "../lib/user-roles.ts";

export function requirePermission(section: Section) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const appUser = req.appUser;
    if (!appUser) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (appUser.role === "admin") {
      next();
      return;
    }

    if (
      appUser.role === "logistician" &&
      appUser.editableSections.includes(section)
    ) {
      next();
      return;
    }

    res.status(403).json({ error: "Недостаточно прав для этого действия" });
  };
}

export function requireAnySectionAccess(sections: readonly Section[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const appUser = req.appUser;
    if (!appUser) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (
      appUser.role === "admin" ||
      ((appUser.role === "logistician" || appUser.role === "manager") &&
        sections.some((section) => appUser.editableSections.includes(section)))
    ) {
      next();
      return;
    }
    res.status(403).json({ error: "Раздел недоступен" });
  };
}

export function requireSectionAccess(section: Section) {
  return requireAnySectionAccess([section]);
}

/**
 * Product cards are needed by the additional-order form for delivery editors,
 * but the existing order lookup must remain available to users who can access
 * the standalone orders section. Drivers and read-only users must not receive
 * the catalogue through this endpoint.
 */
export function requireOrderProductLookup(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = req.appUser;
  if (
    user &&
    !isDriverUser(user) &&
    (user.role === "admin" ||
      (user.role === "logistician" &&
        (user.editableSections.includes("orders") ||
          user.editableSections.includes("deliveries"))) ||
      (user.role === "manager" && user.editableSections.includes("orders")))
  ) {
    next();
    return;
  }
  res.status(403).json({ error: "Раздел недоступен" });
}

export function requireDeliveryActApproval(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = req.appUser;
  if (
    user?.role === "admin" ||
    ((user?.role === "logistician" || user?.role === "manager") &&
      user.editableSections.includes("deliveries"))
  ) {
    next();
    return;
  }
  res.status(403).json({ error: "Недостаточно прав для подтверждения акта" });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.appUser?.role !== "admin") {
    res.status(403).json({ error: "Требуются права администратора" });
    return;
  }
  next();
}

export function requireDriver(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.appUser || !isDriverUser(req.appUser)) {
    res.status(403).json({ error: "Требуется роль водителя" });
    return;
  }
  next();
}
