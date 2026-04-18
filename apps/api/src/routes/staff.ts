import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getSchemaFlags } from "../db/schemaFlags.js";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { adminOnly } from "../middleware/rbac.js";
import { insertAuditLog } from "../services/auditLog.js";

const router = Router();
router.use(authMiddleware);
router.use(adminOnly);

const roleSchema = z.enum(["admin", "accountant", "viewer", "manager"]);

/**
 * GET /api/staff — list staff (no password hashes)
 */
router.get("/", async (_req, res) => {
  const f = await getSchemaFlags();
  const sc = f.staff_scope_city ? "scope_city" : "NULL::text AS scope_city";
  const { rows } = await query(
    `SELECT id, email, full_name, role, is_active, ${sc}, created_at, updated_at
     FROM staff_users ORDER BY created_at`
  );
  res.json(rows);
});

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().optional(),
  role: roleSchema.default("viewer"),
  scope_city: z.string().max(120).optional().nullable(),
});

/**
 * POST /api/staff — create staff user
 */
router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const f = await getSchemaFlags();
  if (b.role === "manager" && !b.scope_city?.trim()) {
    return res.status(400).json({ error: "Managers require scope_city (city filter)" });
  }
  if (b.role === "manager" && !f.staff_scope_city) {
    return res.status(400).json({ error: "Database missing scope_city column; restart API to run migrations." });
  }
  const hash = await bcrypt.hash(b.password, 10);
  try {
    const { rows } = f.staff_scope_city
      ? await query<{ id: string }>(
          `INSERT INTO staff_users (email, password_hash, full_name, role, is_active, scope_city)
           VALUES ($1,$2,$3,$4,true,$5) RETURNING id`,
          [b.email.toLowerCase(), hash, b.full_name ?? null, b.role, b.role === "manager" ? b.scope_city!.trim() : null]
        )
      : await query<{ id: string }>(
          `INSERT INTO staff_users (email, password_hash, full_name, role, is_active)
           VALUES ($1,$2,$3,$4,true) RETURNING id`,
          [b.email.toLowerCase(), hash, b.full_name ?? null, b.role]
        );
    void insertAuditLog(req, {
      action: "staff.create",
      entityType: "staff_user",
      entityId: rows[0].id,
      details: { email: b.email.toLowerCase(), role: b.role },
    });
    res.status(201).json({ id: rows[0].id });
  } catch (e: unknown) {
    const code = typeof e === "object" && e && "code" in e ? (e as { code?: string }).code : "";
    if (code === "23505") return res.status(409).json({ error: "Email already exists" });
    throw e;
  }
});

const patchSchema = z.object({
  full_name: z.string().nullable().optional(),
  role: roleSchema.optional(),
  is_active: z.boolean().optional(),
  scope_city: z.string().max(120).nullable().optional(),
  password: z.string().min(6).optional(),
});

/**
 * PATCH /api/staff/:id — update role, active flag, scope, optional password
 */
router.patch("/:id", async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const id = req.params.id;
  const f = await getSchemaFlags();
  const sc = f.staff_scope_city ? "scope_city" : "NULL::text AS scope_city";
  const { rows: cur } = await query<{ role: string; scope_city: string | null }>(
    `SELECT role, ${sc} FROM staff_users WHERE id = $1`,
    [id]
  );
  if (!cur[0]) return res.status(404).json({ error: "Not found" });
  const mergedRole = b.role ?? cur[0].role;
  const mergedScope =
    b.scope_city !== undefined ? (b.scope_city?.trim() || null) : cur[0].scope_city;
  if (mergedRole === "manager" && !(mergedScope ?? "").trim()) {
    return res.status(400).json({ error: "Manager role requires scope_city" });
  }
  if (b.password) {
    const hash = await bcrypt.hash(b.password, 10);
    await query(`UPDATE staff_users SET password_hash = $1, updated_at = now() WHERE id = $2`, [hash, id]);
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (b.full_name !== undefined) {
    sets.push(`full_name = $${i++}`);
    vals.push(b.full_name);
  }
  if (b.role !== undefined) {
    sets.push(`role = $${i++}`);
    vals.push(b.role);
  }
  if (b.is_active !== undefined) {
    sets.push(`is_active = $${i++}`);
    vals.push(b.is_active);
  }
  if (b.scope_city !== undefined && f.staff_scope_city) {
    sets.push(`scope_city = $${i++}`);
    vals.push(b.scope_city?.trim() || null);
  }
  if (sets.length) {
    vals.push(id);
    await query(`UPDATE staff_users SET ${sets.join(", ")}, updated_at = now() WHERE id = $${i}`, vals);
  }
  void insertAuditLog(req, {
    action: "staff.update",
    entityType: "staff_user",
    entityId: id,
    details: { fields: Object.keys(b) },
  });
  res.json({ ok: true });
});

export default router;
