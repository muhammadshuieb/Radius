import type { Request, Response, NextFunction } from "express";
import type { AppRole } from "./auth.js";

export function requireRoles(...allowed: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden", required: allowed });
    }
    next();
  };
}

/** Accountant + Admin can mutate billing; viewer read-only */
export const billingWrite = requireRoles("admin", "accountant");
export const adminOnly = requireRoles("admin");
/** All authenticated staff including area managers (city-scoped). */
export const anyStaff = requireRoles("admin", "accountant", "viewer", "manager");
/** Finance / inventory / accounting — not managers (global business data). */
export const financeStaff = requireRoles("admin", "accountant", "viewer");
