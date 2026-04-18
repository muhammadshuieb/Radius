import type { NextFunction, Request, Response } from "express";
import { DEFAULT_TENANT_ID } from "../constants/tenant.js";

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
    }
  }
}

/**
 * After auth: scope API to the staff user's tenant (JWT `tid`).
 */
export function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.tenantId = req.user.tenant_id ?? DEFAULT_TENANT_ID;
  next();
}
