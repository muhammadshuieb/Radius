import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { adminOnly, billingWrite, financeStaff } from "../middleware/rbac.js";

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/expenses
 */
router.get("/", financeStaff, async (_req, res) => {
  const { rows } = await query(`SELECT * FROM expenses ORDER BY incurred_at DESC LIMIT 500`);
  res.json(rows);
});

const schema = z.object({
  title: z.string().min(1),
  category: z.string().optional(),
  amount: z.number().positive(),
  incurred_at: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * POST /api/expenses — admin or accountant
 */
router.post("/", billingWrite, async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO expenses (title, category, amount, incurred_at, notes, created_by)
     VALUES ($1,$2,$3, coalesce($4::timestamptz, now()), $5, $6) RETURNING id`,
    [b.title, b.category ?? null, b.amount, b.incurred_at ?? null, b.notes ?? null, req.user!.id]
  );
  res.status(201).json(rows[0]);
});

/**
 * DELETE /api/expenses/:id — admin
 */
router.delete("/:id", adminOnly, async (req, res) => {
  await query(`DELETE FROM expenses WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

export default router;
