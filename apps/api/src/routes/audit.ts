import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { adminOnly } from "../middleware/rbac.js";

const router = Router();
router.use(authMiddleware);

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /api/audit/logs — admin: recent audit entries with staff email
 */
router.get("/logs", adminOnly, async (req, res) => {
  const q = listSchema.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: q.error.flatten() });
  const { limit, offset } = q.data;
  const { rows: countRows } = await query<{ c: number }>(`SELECT count(*)::int AS c FROM audit_logs`);
  const total = countRows[0]?.c ?? 0;
  const { rows } = await query<{
    id: string;
    created_at: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    details: unknown;
    ip: string | null;
    staff_email: string | null;
  }>(
    `SELECT a.id, a.created_at, a.action, a.entity_type, a.entity_id, a.details, a.ip,
            u.email AS staff_email
     FROM audit_logs a
     LEFT JOIN staff_users u ON u.id = a.staff_user_id
     ORDER BY a.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json({ items: rows, total, limit, offset });
});

export default router;
