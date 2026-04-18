import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { adminOnly, billingWrite, financeStaff } from "../middleware/rbac.js";

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/sales
 */
router.get("/", financeStaff, async (_req, res) => {
  const { rows } = await query(
    `SELECT s.*, si.product_id, si.qty, si.unit_price, p.name AS product_name
     FROM sales s
     LEFT JOIN sale_items si ON si.sale_id = s.id
     LEFT JOIN products p ON p.id = si.product_id
     ORDER BY s.created_at DESC LIMIT 200`
  );
  res.json(rows);
});

const itemSchema = z.object({
  product_id: z.string().uuid(),
  qty: z.number().int().positive(),
  unit_price: z.number().nonnegative(),
});

const saleSchema = z.object({
  customer_label: z.string().optional(),
  subscriber_id: z.string().uuid().optional().nullable(),
  items: z.array(itemSchema).min(1),
  create_invoice: z.boolean().optional(),
});

/**
 * POST /api/sales — link products to customer; optional invoice row
 */
router.post("/", billingWrite, async (req, res) => {
  const parsed = saleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  let total = 0;
  for (const it of b.items) total += it.qty * it.unit_price;

  let invoiceId: string | null = null;
  if (b.create_invoice) {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO invoices (subscriber_id, period, title, amount, tax_amount, currency, status, meta)
       VALUES ($1,'one_time',$2,$3,0,'USD','unpaid', $4::jsonb) RETURNING id`,
      [
        b.subscriber_id ?? null,
        `Sale — ${b.customer_label ?? "walk-in"}`,
        total,
        JSON.stringify({ source: "inventory_sale" }),
      ]
    );
    invoiceId = rows[0].id;
  }

  const { rows: saleRows } = await query<{ id: string }>(
    `INSERT INTO sales (customer_label, subscriber_id, total, invoice_id, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [b.customer_label ?? null, b.subscriber_id ?? null, total, invoiceId, req.user!.id]
  );
  const saleId = saleRows[0].id;

  for (const it of b.items) {
    await query(
      `INSERT INTO sale_items (sale_id, product_id, qty, unit_price) VALUES ($1,$2,$3,$4)`,
      [saleId, it.product_id, it.qty, it.unit_price]
    );
    await query(`UPDATE products SET stock_qty = stock_qty - $1 WHERE id = $2`, [it.qty, it.product_id]);
  }

  res.status(201).json({ id: saleId, invoice_id: invoiceId, total });
});

/**
 * DELETE /api/sales/:id — admin rollback (does not restock in this version)
 */
router.delete("/:id", adminOnly, async (req, res) => {
  await query(`DELETE FROM sales WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

export default router;
