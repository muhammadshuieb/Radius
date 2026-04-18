import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { DEFAULT_TENANT_ID } from "../constants/tenant.js";
import { getSchemaFlags } from "../db/schemaFlags.js";
import { query } from "../db/pool.js";

export type AppRole = "admin" | "accountant" | "viewer" | "manager";

export interface AuthUser {
  id: string;
  email: string;
  role: AppRole;
  scope_city: string | null;
  /** Tenant scope for multi-tenant data isolation. */
  tenant_id: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const hdr = req.headers.authorization;
  if (!hdr?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = hdr.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string; tid?: string };
    const f = await getSchemaFlags();
    const scopeSel = f.staff_scope_city ? "scope_city" : "NULL::text AS scope_city";
    const { rows } = await query<{
      id: string;
      email: string;
      role: AppRole;
      is_active: boolean;
      scope_city: string | null;
      tenant_id: string | null;
    }>(
      `SELECT id, email, role, is_active, ${scopeSel}, COALESCE(tenant_id, $2::uuid) AS tenant_id FROM staff_users WHERE id = $1`,
      [payload.sub, DEFAULT_TENANT_ID]
    );
    const u = rows[0];
    if (!u || !u.is_active) return res.status(401).json({ error: "Invalid user" });
    const tid = u.tenant_id ?? payload.tid ?? DEFAULT_TENANT_ID;
    req.user = { id: u.id, email: u.email, role: u.role, scope_city: u.scope_city ?? null, tenant_id: tid };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
