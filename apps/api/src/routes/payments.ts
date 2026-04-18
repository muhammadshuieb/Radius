import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { billingWrite, financeStaff } from "../middleware/rbac.js";
import { broadcast } from "../ws/broadcast.js";

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/payments — list recent; optional ?subscriber_id=
 */
router.get("/", financeStaff, async (req, res) => {
  const subId = typeof req.query.subscriber_id === "string" ? req.query.subscriber_id : undefined;
  const { rows } = await query(
    subId
      ? `SELECT p.*, s.username FROM payments p LEFT JOIN subscribers s ON s.id = p.subscriber_id
         WHERE p.subscriber_id = $1
         ORDER BY p.paid_at DESC LIMIT 200`
      : `SELECT p.*, s.username FROM payments p LEFT JOIN subscribers s ON s.id = p.subscriber_id
         ORDER BY p.paid_at DESC LIMIT 500`,
    subId ? [subId] : []
  );
  res.json(rows);
});

const createSchema = z.object({
  invoice_id: z.string().uuid().optional().nullable(),
  subscriber_id: z.string().uuid().optional().nullable(),
  amount: z.number().positive(),
  method: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * POST /api/payments — record user payment / renewal
 */
router.post("/", billingWrite, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO payments (invoice_id, subscriber_id, amount, method, reference, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [b.invoice_id ?? null, b.subscriber_id ?? null, b.amount, b.method ?? null, b.reference ?? null, b.notes ?? null]
  );
  broadcast("payments.updated", {});
  res.status(201).json(rows[0]);
});

export default router;
