import { Router } from "express";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { adminOnly, billingWrite, financeStaff } from "../middleware/rbac.js";
import { broadcast } from "../ws/broadcast.js";

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/invoices — list with optional subscriber_id
 */
router.get("/", financeStaff, async (req, res) => {
  const subId = req.query.subscriber_id as string | undefined;
  const { rows } = await query(
    subId
      ? `SELECT * FROM invoices WHERE subscriber_id = $1 ORDER BY issued_at DESC LIMIT 200`
      : `SELECT * FROM invoices ORDER BY issued_at DESC LIMIT 200`,
    subId ? [subId] : []
  );
  res.json(rows);
});

const createSchema = z.object({
  subscriber_id: z.string().uuid().optional().nullable(),
  period: z.enum(["monthly", "yearly", "one_time"]).default("monthly"),
  title: z.string().min(1),
  amount: z.number().nonnegative(),
  tax_amount: z.number().nonnegative().optional(),
  currency: z.string().length(3).default("USD"),
  status: z.enum(["paid", "unpaid", "partial"]).optional(),
  due_at: z.string().optional().nullable(),
});

/**
 * POST /api/invoices — create invoice (billing write)
 */
router.post("/", billingWrite, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO invoices (subscriber_id, period, title, amount, tax_amount, currency, status, due_at)
     VALUES ($1,$2,$3,$4,$5,$6, coalesce($7,'unpaid'), $8) RETURNING id`,
    [
      b.subscriber_id ?? null,
      b.period,
      b.title,
      b.amount,
      b.tax_amount ?? 0,
      b.currency,
      b.status ?? "unpaid",
      b.due_at ?? null,
    ]
  );
  broadcast("invoices.updated", { id: rows[0].id });
  res.status(201).json(rows[0]);
});

/**
 * POST /api/invoices/auto — generate monthly/yearly draft invoices for active subscribers (admin)
 */
router.post("/auto", adminOnly, async (req, res) => {
  const schema = z.object({ period: z.enum(["monthly", "yearly"]) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const period = parsed.data.period;
  const { rows: subs } = await query<{ id: string; username: string }>(
    `SELECT s.id, s.username FROM subscribers s WHERE s.status = 'active'`
  );
  let created = 0;
  for (const s of subs) {
    const title = `${period === "monthly" ? "Monthly" : "Yearly"} — ${s.username}`;
    const { rows: pkg } = await query<{ price: string }>(
      `SELECT p.price FROM subscribers s JOIN packages p ON p.id = s.package_id WHERE s.id = $1`,
      [s.id]
    );
    const amount = Number(pkg[0]?.price ?? 0);
    await query(
      `INSERT INTO invoices (subscriber_id, period, title, amount, tax_amount, currency, status)
       VALUES ($1,$2,$3,$4,0,'USD','unpaid')`,
      [s.id, period, title, amount]
    );
    created++;
  }
  broadcast("invoices.updated", { auto: true });
  res.json({ created });
});

/**
 * GET /api/invoices/:id/pdf — PDF export (stream)
 */
router.get("/:id/pdf", financeStaff, async (req, res) => {
  const { rows } = await query(
    `SELECT i.*, s.username FROM invoices i LEFT JOIN subscribers s ON s.id = i.subscriber_id WHERE i.id = $1`,
    [req.params.id]
  );
  const inv = rows[0];
  if (!inv) return res.status(404).json({ error: "Not found" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="invoice-${inv.id}.pdf"`);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);
  doc.fontSize(20).text("Invoice", { underline: true });
  doc.moveDown();
  doc.fontSize(11).text(`Title: ${inv.title}`);
  doc.text(`Amount: ${inv.amount} ${inv.currency}`);
  doc.text(`Status: ${inv.status}`);
  doc.text(`Issued: ${inv.issued_at}`);
  if (inv.username) doc.text(`Subscriber: ${inv.username}`);
  doc.end();
});

/**
 * PATCH /api/invoices/:id/mark-paid
 */
router.patch("/:id/mark-paid", billingWrite, async (req, res) => {
  await query(`UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = $1`, [req.params.id]);
  await query(
    `INSERT INTO payments (invoice_id, subscriber_id, amount, method, reference)
     SELECT id, subscriber_id, amount, 'invoice', $2 FROM invoices WHERE id = $1`,
    [req.params.id, `invoice:${req.params.id}`]
  );
  broadcast("invoices.updated", { id: req.params.id });
  res.json({ ok: true });
});

export default router;
