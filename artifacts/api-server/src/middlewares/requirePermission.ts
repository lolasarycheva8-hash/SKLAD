import type { NextFunction, Request, Response } from "express";
import type { Section } from "@workspace/db";
import { isDriverUser, isLogisticianRole } from "../lib/user-roles.ts";

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
      isLogisticianRole(appUser.role) &&
      (section === "products" ||
        section === "orders" ||
        appUser.editableSections.includes(section))
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
      (isLogisticianRole(appUser.role) &&
        sections.some(
          (section) =>
            section === "products" ||
            section === "orders" ||
            appUser.editableSections.includes(section),
        ))
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
 * Product cards are needed by the additional-order form. Logistician order
 * access is a role default for both logistics roles. Drivers (including legacy
 * driver flags) must not receive the catalogue through this endpoint.
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
      isLogisticianRole(user.role))
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
    (!!user &&
      isLogisticianRole(user.role) &&
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
