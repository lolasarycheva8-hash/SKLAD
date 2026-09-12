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
