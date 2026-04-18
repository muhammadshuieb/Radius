import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { adminOnly, financeStaff } from "../middleware/rbac.js";

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/products/categories
 */
router.get("/categories", financeStaff, async (_req, res) => {
  const { rows } = await query(`SELECT * FROM product_categories ORDER BY name`);
  res.json(rows);
});

/**
 * POST /api/products/categories — admin
 */
router.post("/categories", adminOnly, async (req, res) => {
  const schema = z.object({ name: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { rows } = await query<{ id: string }>(
    `INSERT INTO product_categories (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [parsed.data.name]
  );
  res.status(201).json(rows[0]);
});

/**
 * GET /api/products — inventory list
 */
router.get("/", financeStaff, async (_req, res) => {
  const { rows } = await query(
    `SELECT pr.*, c.name AS category_name FROM products pr
     LEFT JOIN product_categories c ON c.id = pr.category_id
     WHERE pr.is_active = true ORDER BY pr.name`
  );
  res.json(rows);
});

const productSchema = z.object({
  name: z.string().min(1),
  category_id: z.string().uuid().optional().nullable(),
  sku: z.string().optional(),
  price: z.number().nonnegative(),
  stock_qty: z.number().int().nonnegative().default(0),
});

/**
 * POST /api/products
 */
router.post("/", adminOnly, async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO products (name, category_id, sku, price, stock_qty) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [b.name, b.category_id ?? null, b.sku ?? null, b.price, b.stock_qty]
  );
  res.status(201).json(rows[0]);
});

/**
 * PATCH /api/products/:id/stock — adjust quantity
 */
router.patch("/:id/stock", adminOnly, async (req, res) => {
  const schema = z.object({ delta: z.number().int() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await query(`UPDATE products SET stock_qty = stock_qty + $1 WHERE id = $2`, [parsed.data.delta, req.params.id]);
  res.json({ ok: true });
});

export default router;
