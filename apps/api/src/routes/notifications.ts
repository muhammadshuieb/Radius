import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { anyStaff } from "../middleware/rbac.js";

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/notifications — expiring subscriptions & stale unpaid invoices (computed)
 */
router.get("/", anyStaff, async (req, res) => {
  const q = z
    .object({
      expiring_days: z.coerce.number().int().min(1).max(90).default(7),
      unpaid_days: z.coerce.number().int().min(1).max(365).default(30),
    })
    .safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: q.error.flatten() });
  const { expiring_days, unpaid_days } = q.data;

  const { rows: expiring } = await query<{ id: string; username: string; expires_at: string }>(
    `SELECT id, username, expires_at::text
     FROM subscribers
     WHERE status = 'active'
       AND expires_at IS NOT NULL
       AND expires_at <= now() + ($1::int * interval '1 day')
       AND expires_at > now()
     ORDER BY expires_at ASC
     LIMIT 100`,
    [expiring_days]
  );

  const { rows: unpaid } = await query<{ id: string; title: string; amount: string; issued_at: string; username: string | null }>(
    `SELECT i.id, i.title, i.amount::text, i.issued_at::text, s.username
     FROM invoices i
     LEFT JOIN subscribers s ON s.id = i.subscriber_id
     WHERE i.status <> 'paid'
       AND i.issued_at < now() - ($1::int * interval '1 day')
     ORDER BY i.issued_at ASC
     LIMIT 100`,
    [unpaid_days]
  );

  const items: { id: string; severity: "info" | "warn"; title: string; body: string; ref?: { type: string; id: string } }[] = [];

  for (const e of expiring) {
    items.push({
      id: `exp-${e.id}`,
      severity: "warn",
      title: "Subscription expiring",
      body: `${e.username} expires ${e.expires_at}`,
      ref: { type: "subscriber", id: e.id },
    });
  }
  for (const u of unpaid) {
    items.push({
      id: `inv-${u.id}`,
      severity: "warn",
      title: "Unpaid invoice",
      body: `${u.title} — ${u.username ?? "—"} (${u.amount})`,
      ref: { type: "invoice", id: u.id },
    });
  }

  res.json({
    expiring_days,
    unpaid_days,
    items,
    counts: { expiring: expiring.length, unpaid_invoices: unpaid.length },
  });
});

export default router;
