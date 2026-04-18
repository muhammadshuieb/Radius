import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { getSchemaFlags } from "../db/schemaFlags.js";
import { query } from "../db/pool.js";
import { config } from "../config.js";
import { DEFAULT_TENANT_ID } from "../constants/tenant.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /api/auth/login — body: { email, password } → { token, user }
 */
router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;
  const f = await getSchemaFlags();
  const scopeSel = f.staff_scope_city ? "scope_city" : "NULL::text AS scope_city";
  const { rows } = await query<{
    id: string;
    email: string;
    password_hash: string;
    full_name: string | null;
    role: string;
    is_active: boolean;
    scope_city: string | null;
    tenant_id: string | null;
  }>(
    `SELECT id, email, password_hash, full_name, role, is_active, ${scopeSel},
            COALESCE(tenant_id, $2::uuid) AS tenant_id
     FROM staff_users WHERE lower(email) = lower($1)`,
    [email, DEFAULT_TENANT_ID]
  );
  const u = rows[0];
  if (!u || !u.is_active) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });
  const tid = u.tenant_id ?? DEFAULT_TENANT_ID;
  const signOpts = { expiresIn: config.jwtExpires } as SignOptions;
  const token = jwt.sign({ sub: u.id, tid }, config.jwtSecret, signOpts);
  res.json({
    token,
    user: {
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      role: u.role,
      scope_city: u.scope_city,
      tenant_id: tid,
    },
  });
});

/**
 * GET /api/auth/me — Bearer token → current user
 */
router.get("/me", authMiddleware, async (req, res) => {
  const f = await getSchemaFlags();
  const scopeSel = f.staff_scope_city ? "scope_city" : "NULL::text AS scope_city";
  const { rows } = await query<{
    id: string;
    email: string;
    full_name: string | null;
    role: string;
    scope_city: string | null;
    tenant_id: string | null;
  }>(
    `SELECT id, email, full_name, role, ${scopeSel}, COALESCE(tenant_id, $2::uuid) AS tenant_id FROM staff_users WHERE id = $1`,
    [req.user!.id, DEFAULT_TENANT_ID]
  );
  const u = rows[0];
  if (!u) return res.status(404).json({ error: "Not found" });
  res.json(u);
});

export default router;
