import { Router } from "express";
import { z } from "zod";
import { DEFAULT_TENANT_ID } from "../constants/tenant.js";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { adminOnly, anyStaff } from "../middleware/rbac.js";
import { broadcast } from "../ws/broadcast.js";
import { insertAuditLog } from "../services/auditLog.js";

const router = Router();
router.use(authMiddleware);
router.use(tenantMiddleware);

/**
 * GET /api/packages — list packages for cards UI
 * Query: include_inactive=true (admin only) — lists inactive too for management
 */
router.get("/", anyStaff, async (req, res) => {
  const all = req.query.include_inactive === "true";
  if (all && req.user?.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await query(
    all
      ? `SELECT id, name, speed_up, speed_down, data_limit_gb, price, currency, duration_days, is_default, is_active, created_at
         FROM packages WHERE tenant_id = $1 ORDER BY is_active DESC, is_default DESC, name`
      : `SELECT id, name, speed_up, speed_down, data_limit_gb, price, currency, duration_days, is_default, is_active, created_at
         FROM packages WHERE tenant_id = $1 AND is_active = true ORDER BY is_default DESC, name`,
    [tid]
  );
  res.json(rows);
});

const currencySchema = z
  .string()
  .length(3)
  .transform((s) => s.trim().toUpperCase())
  .refine((s) => /^[A-Z]{3}$/.test(s), { message: "currency must be ISO 4217 (3 letters)" });

const pkgSchema = z.object({
  name: z.string().min(1),
  speed_up: z.string().default("10M"),
  speed_down: z.string().default("10M"),
  data_limit_gb: z.number().nullable().optional(),
  price: z.number().nonnegative(),
  currency: currencySchema.optional().default("USD"),
  duration_days: z.number().int().positive(),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

/**
 * POST /api/packages — create package (admin)
 */
router.post("/", adminOnly, async (req, res) => {
  const parsed = pkgSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  if (b.is_default) {
    await query(`UPDATE packages SET is_default = false WHERE tenant_id = $1`, [tid]);
  }
  const { rows } = await query<{ id: string }>(
    `INSERT INTO packages (name, speed_up, speed_down, data_limit_gb, price, currency, duration_days, is_default, is_active, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,coalesce($8,false), coalesce($9,true), $10)
     RETURNING id`,
    [
      b.name,
      b.speed_up,
      b.speed_down,
      b.data_limit_gb ?? null,
      b.price,
      b.currency,
      b.duration_days,
      b.is_default ?? false,
      b.is_active ?? true,
      tid,
    ]
  );
  broadcast("packages.updated", {});
  void insertAuditLog(req, {
    action: "package.create",
    entityType: "package",
    entityId: rows[0].id,
    details: { name: b.name },
  });
  res.status(201).json(rows[0]);
});

/**
 * PATCH /api/packages/:id — update (admin)
 */
router.patch("/:id", adminOnly, async (req, res) => {
  const id = req.params.id;
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  const parsed = pkgSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  if (b.is_default) await query(`UPDATE packages SET is_default = false WHERE tenant_id = $1`, [tid]);
  const fields: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const k of ["name", "speed_up", "speed_down", "data_limit_gb", "price", "currency", "duration_days", "is_default", "is_active"] as const) {
    if (k in b && b[k] !== undefined) {
      fields.push(`${k} = $${i++}`);
      vals.push(b[k]);
    }
  }
  if (!fields.length) return res.status(400).json({ error: "No fields" });
  vals.push(id, tid);
  await query(`UPDATE packages SET ${fields.join(", ")} WHERE id = $${i} AND tenant_id = $${i + 1}`, vals);
  broadcast("packages.updated", { id });
  void insertAuditLog(req, {
    action: "package.update",
    entityType: "package",
    entityId: id,
    details: { fields: Object.keys(b) },
  });
  res.json({ ok: true });
});

export default router;
