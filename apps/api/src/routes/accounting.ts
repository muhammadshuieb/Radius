import { Router } from "express";
import { radiusAccountingTablesExist } from "../db/ensureRadiusSchema.js";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { adminOnly, financeStaff } from "../middleware/rbac.js";
import {
  aggregateUserUsageDailyYesterday,
  getUserUsageGb,
  radiusAccountingCycle,
  syncSubscribersFromRadacct,
} from "../services/radiusAccounting.js";

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/accounting/usage/:username — download+upload totals (GiB) from radacct
 */
router.get("/usage/:username", financeStaff, async (req, res) => {
  const u = await getUserUsageGb(req.params.username);
  res.json({
    username: u.username,
    usage_gb: u.total_gb.toFixed(4),
    input_gb: u.input_gb.toFixed(4),
    output_gb: u.output_gb.toFixed(4),
    input_octets: u.input_octets,
    output_octets: u.output_octets,
  });
});

/**
 * GET /api/accounting/active-sessions — rows still open (acctstoptime IS NULL)
 */
router.get("/active-sessions", financeStaff, async (_req, res) => {
  if (!(await radiusAccountingTablesExist())) {
    return res.json({ count: 0, sessions: [], note: "radacct not installed" });
  }
  const { rows } = await query(
    `SELECT radacctid, username, nasipaddress, acctstarttime, acctupdatetime,
            COALESCE(acctinputoctets,0)::text AS acctinputoctets,
            COALESCE(acctoutputoctets,0)::text AS acctoutputoctets,
            framedipaddress, acctsessionid
     FROM radacct
     WHERE acctstoptime IS NULL AND username IS NOT NULL AND btrim(username) <> ''
     ORDER BY acctstarttime DESC NULLS LAST
     LIMIT 500`
  );
  const { rows: cnt } = await query<{ c: string }>(
    `SELECT count(*)::text AS c FROM radacct WHERE acctstoptime IS NULL`
  );
  res.json({ count: Number(cnt[0]?.c ?? 0), sessions: rows });
});

/**
 * GET /api/accounting/summary-today — heavy path: sums radacct; prefer dashboard + daily rollup for graphs
 */
router.get("/summary-today", financeStaff, async (_req, res) => {
  if (!(await radiusAccountingTablesExist())) {
    return res.json({ total_usage_gb_today: 0, note: "radacct not installed" });
  }
  const { rows } = await query<{ gb: string }>(
    `SELECT (COALESCE(SUM(acctinputoctets),0) + COALESCE(SUM(acctoutputoctets),0))::numeric
            / POWER(1024::numeric, 3) AS gb
     FROM radacct
     WHERE acctstarttime IS NOT NULL
       AND acctstarttime >= date_trunc('day', now())`
  );
  res.json({ total_usage_gb_today: Number(rows[0]?.gb ?? 0) });
});

/**
 * POST /api/accounting/sync — recompute subscribers from radacct (admin)
 */
router.post("/sync", adminOnly, async (_req, res) => {
  await syncSubscribersFromRadacct();
  res.json({ ok: true });
});

/**
 * POST /api/accounting/run-cycle — sync + enforce limits (admin; normally done by worker)
 */
router.post("/run-cycle", adminOnly, async (_req, res) => {
  const r = await radiusAccountingCycle();
  res.json({ ok: true, disabled_usernames: r.enforce.disabled_usernames });
});

/**
 * POST /api/accounting/aggregate-yesterday — fill user_usage_daily (admin)
 */
router.post("/aggregate-yesterday", adminOnly, async (_req, res) => {
  await aggregateUserUsageDailyYesterday();
  res.json({ ok: true });
});

export default router;
