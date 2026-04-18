import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { insertAuditLog } from "../services/auditLog.js";
import { billingWrite, financeStaff } from "../middleware/rbac.js";

const router = Router();
router.use(authMiddleware);

const txCreate = z.object({
  subscriber_id: z.string().uuid().optional().nullable(),
  type: z.enum(["deposit", "withdraw", "invoice", "adjustment"]),
  amount: z.number().finite(),
  currency: z.string().length(3).optional().default("USD"),
  notes: z.string().optional().nullable(),
  meta: z.record(z.unknown()).optional(),
});

/**
 * GET /api/finance/transactions — ledger with filters
 */
router.get("/transactions", financeStaff, async (req, res) => {
  const q = z
    .object({
      subscriber_id: z.string().uuid().optional(),
      type: z.enum(["deposit", "withdraw", "invoice", "adjustment"]).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: q.error.flatten() });
  const p = q.data;
  const cond: string[] = ["1=1"];
  const params: unknown[] = [];
  let i = 1;
  if (p.subscriber_id) {
    cond.push(`t.subscriber_id = $${i++}`);
    params.push(p.subscriber_id);
  }
  if (p.type) {
    cond.push(`t.type = $${i++}::financial_tx_type`);
    params.push(p.type);
  }
  if (p.from) {
    cond.push(`t.created_at >= $${i++}::timestamptz`);
    params.push(p.from);
  }
  if (p.to) {
    cond.push(`t.created_at <= $${i++}::timestamptz`);
    params.push(p.to);
  }
  params.push(p.limit, p.offset);
  const sql = `
    SELECT t.*, s.username AS subscriber_username, u.email AS staff_email
    FROM financial_transactions t
    LEFT JOIN subscribers s ON s.id = t.subscriber_id
    LEFT JOIN staff_users u ON u.id = t.staff_user_id
    WHERE ${cond.join(" AND ")}
    ORDER BY t.created_at DESC
    LIMIT $${i++} OFFSET $${i}
  `;
  const countSql = `
    SELECT count(*)::int AS c FROM financial_transactions t WHERE ${cond.join(" AND ")}
  `;
  const countParams = params.slice(0, -2);
  const [{ rows }, { rows: cr }] = await Promise.all([query(sql, params), query(countSql, countParams)]);
  res.json({ items: rows, total: cr[0]?.c ?? 0, limit: p.limit, offset: p.offset });
});

/**
 * POST /api/finance/transactions — record movement
 */
router.post("/transactions", billingWrite, async (req, res) => {
  const parsed = txCreate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const uid = req.user?.id;
  const amt = b.type === "withdraw" ? -Math.abs(b.amount) : Math.abs(b.amount);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO financial_transactions (subscriber_id, staff_user_id, type, amount, currency, notes, meta)
     VALUES ($1,$2,$3::financial_tx_type,$4,$5,$6,$7::jsonb) RETURNING id`,
    [
      b.subscriber_id ?? null,
      uid ?? null,
      b.type,
      amt,
      b.currency.toUpperCase(),
      b.notes ?? null,
      JSON.stringify(b.meta ?? {}),
    ]
  );
  void insertAuditLog(req, {
    action: "finance.transaction.create",
    entityType: "financial_transaction",
    entityId: rows[0].id,
    details: { type: b.type, amount: b.amount, subscriber_id: b.subscriber_id ?? null },
  });
  res.status(201).json({ id: rows[0].id });
});

/**
 * GET /api/finance/reports/summary — daily / monthly / yearly aggregates
 */
router.get("/reports/summary", financeStaff, async (req, res) => {
  const q = z
    .object({
      granularity: z.enum(["day", "month", "year"]),
      date: z.string().optional(),
      year: z.coerce.number().int().optional(),
      month: z.coerce.number().int().min(1).max(12).optional(),
    })
    .safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: q.error.flatten() });
  const p = q.data;
  if (p.granularity === "day") {
    const day = p.date ?? new Date().toISOString().slice(0, 10);
    const { rows } = await query<{
      deposits: string;
      withdraws: string;
      invoices: string;
      adjustments: string;
    }>(
      `SELECT
         coalesce(sum(CASE WHEN type = 'deposit' THEN amount ELSE 0 END),0)::text AS deposits,
         coalesce(sum(CASE WHEN type = 'withdraw' THEN abs(amount) ELSE 0 END),0)::text AS withdraws,
         coalesce(sum(CASE WHEN type = 'invoice' THEN amount ELSE 0 END),0)::text AS invoices,
         coalesce(sum(CASE WHEN type = 'adjustment' THEN amount ELSE 0 END),0)::text AS adjustments
       FROM financial_transactions
       WHERE (created_at AT TIME ZONE 'UTC')::date = $1::date`,
      [day]
    );
    const r = rows[0];
    const dep = Number(r?.deposits ?? 0);
    const w = Number(r?.withdraws ?? 0);
    const inv = Number(r?.invoices ?? 0);
    const adj = Number(r?.adjustments ?? 0);
    return res.json({
      granularity: "day",
      period: day,
      totals: { deposits: dep, withdraws: w, invoices: inv, adjustments: adj, net: dep - w + inv + adj },
    });
  }
  if (p.granularity === "month") {
    const y = p.year ?? new Date().getFullYear();
    const m = p.month ?? new Date().getMonth() + 1;
    const { rows } = await query<{ deposits: string; withdraws: string; net: string }>(
      `SELECT
         coalesce(sum(CASE WHEN type = 'deposit' THEN amount ELSE 0 END),0)::text AS deposits,
         coalesce(sum(CASE WHEN type = 'withdraw' THEN abs(amount) ELSE 0 END),0)::text AS withdraws,
         coalesce(sum(amount),0)::text AS net
       FROM financial_transactions
       WHERE extract(year from created_at AT TIME ZONE 'UTC') = $1
         AND extract(month from created_at AT TIME ZONE 'UTC') = $2`,
      [y, m]
    );
    const r = rows[0];
    return res.json({
      granularity: "month",
      year: y,
      month: m,
      totals: {
        deposits: Number(r?.deposits ?? 0),
        withdraws: Number(r?.withdraws ?? 0),
        net: Number(r?.net ?? 0),
      },
    });
  }
  const y = p.year ?? new Date().getFullYear();
  const { rows } = await query<{ m: string; net: string }>(
    `SELECT extract(month from created_at AT TIME ZONE 'UTC')::int AS m,
            coalesce(sum(amount),0)::text AS net
     FROM financial_transactions
     WHERE extract(year from created_at AT TIME ZONE 'UTC') = $1
     GROUP BY 1 ORDER BY 1`,
    [y]
  );
  res.json({
    granularity: "year",
    year: y,
    months: rows.map((r) => ({ month: Number(r.m), net: Number(r.net) })),
  });
});

/**
 * GET /api/finance/reports/unpaid-invoices
 */
router.get("/reports/unpaid-invoices", financeStaff, async (_req, res) => {
  const { rows } = await query(
    `SELECT i.id, i.title, i.amount, i.currency, i.status, i.issued_at, i.due_at,
            s.username, s.id AS subscriber_id
     FROM invoices i
     LEFT JOIN subscribers s ON s.id = i.subscriber_id
     WHERE i.status <> 'paid'
     ORDER BY i.issued_at DESC
     LIMIT 500`
  );
  res.json({ items: rows });
});

export default router;
