import type { Request } from "express";
import { Router } from "express";
import { DEFAULT_TENANT_ID } from "../constants/tenant.js";
import { radiusAccountingTablesExist } from "../db/ensureRadiusSchema.js";
import { subscriberCityScope } from "../lib/managerScope.js";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { anyStaff } from "../middleware/rbac.js";

const router = Router();
router.use(authMiddleware);

function subScopeWhere(req: Request, alias = "s", paramIndex = 1): { sql: string; params: unknown[] } {
  const tid = req.user?.tenant_id ?? DEFAULT_TENANT_ID;
  const sc = subscriberCityScope(alias, req, paramIndex + 1);
  const tenantSql = ` AND ${alias}.tenant_id = $${paramIndex}`;
  if (sc.sql === "TRUE") {
    return { sql: tenantSql, params: [tid] };
  }
  return { sql: `${tenantSql} AND (${sc.sql})`, params: [tid, ...sc.params] };
}

function payScopeWhere(req: Request, pAlias = "p", paramIndex = 1): { sql: string; params: unknown[] } {
  const tid = req.user?.tenant_id ?? DEFAULT_TENANT_ID;
  const u = req.user;
  if (!u || u.role !== "manager") {
    return { sql: ` AND ${pAlias}.tenant_id = $${paramIndex}`, params: [tid] };
  }
  if (!u.scope_city?.trim()) return { sql: " AND FALSE ", params: [] };
  const sc = subscriberCityScope("s", req, paramIndex + 1);
  if (sc.sql === "FALSE") return { sql: " AND FALSE ", params: [] };
  return {
    sql: ` AND ${pAlias}.tenant_id = $${paramIndex} AND EXISTS (SELECT 1 FROM subscribers s WHERE s.id = ${pAlias}.subscriber_id AND (${sc.sql}))`,
    params: [tid, ...sc.params],
  };
}

/**
 * GET /api/dashboard/summary — totals + simple time series for charts
 * Query: revenue_days (default 30)
 */
router.get("/summary", anyStaff, async (req, res) => {
  const revenueDays = Math.min(365, Math.max(7, Number(req.query.revenue_days) || 30));
  const isAdmin = req.user?.role === "admin";
  const radiusOk = await radiusAccountingTablesExist();
  const sw = subScopeWhere(req, "s", 1);
  const pw30 = payScopeWhere(req, "p", 1);
  const pwR = payScopeWhere(req, "p", 2);
  const swGrowth = subScopeWhere(req, "s", 2);

  const [users, active, expired, revenue, paymentsSeries, subscriberGrowth] = await Promise.all([
    query<{ c: string }>(`SELECT count(*)::text AS c FROM subscribers s WHERE 1=1${sw.sql}`, sw.params),
    query<{ c: string }>(
      `SELECT count(*)::text AS c FROM subscribers s WHERE s.status = 'active'${sw.sql}`,
      sw.params
    ),
    query<{ c: string }>(
      `SELECT count(*)::text AS c FROM subscribers s WHERE s.status = 'expired'${sw.sql}`,
      sw.params
    ),
    query<{ total: string }>(
      `SELECT coalesce(sum(p.amount),0)::text AS total FROM payments p
       WHERE paid_at >= now() - interval '30 days'${pw30.sql}`,
      [...pw30.params]
    ),
    query<{ d: string; amount: string }>(
      `SELECT date_trunc('day', paid_at)::date::text AS d, coalesce(sum(p.amount),0)::text AS amount
       FROM payments p
       WHERE paid_at >= now() - ($1::int * interval '1 day')${pwR.sql}
       GROUP BY 1 ORDER BY 1`,
      [revenueDays, ...pwR.params]
    ),
    query<{ d: string; c: string }>(
      `SELECT date_trunc('day', s.created_at)::date::text AS d, count(*)::text AS c
       FROM subscribers s
       WHERE s.created_at >= now() - ($1::int * interval '1 day')${swGrowth.sql}
       GROUP BY 1 ORDER BY 1`,
      [revenueDays, ...swGrowth.params]
    ),
  ]);

  let activeRadius: { rows: { c: string }[] } = { rows: [{ c: "0" }] };
  let usageToday: { rows: { gb: string }[] } = { rows: [{ gb: "0" }] };
  let topUsersLifetime: { rows: { username: string; gb: string }[] } = { rows: [] };
  let topUsers7dRollup: { rows: { username: string; gb: string }[] } = { rows: [] };
  let rollupUtcToday: { rows: { gb: string }[] } = { rows: [{ gb: "0" }] };

  const dashTid = req.user?.tenant_id ?? DEFAULT_TENANT_ID;
  if (radiusOk) {
    try {
      [activeRadius, usageToday, topUsersLifetime, topUsers7dRollup, rollupUtcToday] = await Promise.all([
        query<{ c: string }>(
          `SELECT count(*)::text AS c FROM radacct WHERE acctstoptime IS NULL AND tenant_id = $1`,
          [dashTid]
        ),
        query<{ gb: string }>(
          `SELECT (COALESCE(SUM(acctinputoctets),0) + COALESCE(SUM(acctoutputoctets),0))::numeric
                  / POWER(1024::numeric, 3) AS gb
           FROM radacct
           WHERE acctstarttime >= date_trunc('day', now()) AND tenant_id = $1`,
          [dashTid]
        ),
        query<{ username: string; gb: string }>(
          `SELECT username,
                  ((COALESCE(input_bytes,0) + COALESCE(output_bytes,0))::numeric
                   / POWER(1024::numeric, 3))::text AS gb
           FROM user_usage_live
           WHERE tenant_id = $1
           ORDER BY (COALESCE(input_bytes,0) + COALESCE(output_bytes,0)) DESC NULLS LAST
           LIMIT 10`,
          [dashTid]
        ),
        query<{ username: string; gb: string }>(
          `SELECT u.username,
                  (SUM(u.used_gb))::text AS gb
           FROM user_usage_daily u
           INNER JOIN subscribers s ON lower(btrim(s.username)) = lower(btrim(u.username)) AND s.tenant_id = $1
           WHERE u.usage_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 7
           GROUP BY u.username
           ORDER BY SUM(u.used_gb) DESC NULLS LAST
           LIMIT 10`,
          [dashTid]
        ),
        query<{ gb: string }>(
          `SELECT coalesce(sum(u.used_gb), 0)::text AS gb
           FROM user_usage_daily u
           INNER JOIN subscribers s ON lower(btrim(s.username)) = lower(btrim(u.username)) AND s.tenant_id = $1
           WHERE u.usage_date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`,
          [dashTid]
        ),
      ]);
    } catch (err) {
      console.warn("[dashboard] RADIUS metrics skipped:", err);
    }
  }

  const pm = payScopeWhere(req, "p", 1);
  const prevMonth = await query<{ total: string }>(
    `SELECT coalesce(sum(p.amount),0)::text AS total FROM payments p
     WHERE paid_at >= date_trunc('month', now() - interval '1 month')
       AND paid_at < date_trunc('month', now())${pm.sql}`,
    pm.params
  );
  const thisMonth = await query<{ total: string }>(
    `SELECT coalesce(sum(p.amount),0)::text AS total FROM payments p
     WHERE paid_at >= date_trunc('month', now())${pm.sql}`,
    pm.params
  );
  const prev = Number(prevMonth.rows[0]?.total ?? 0);
  const cur = Number(thisMonth.rows[0]?.total ?? 0);
  const growthPct = prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0;

  let last_backup:
    | null
    | {
        created_at: string;
        status: string;
        drive_uploaded: boolean;
        filename: string | null;
        id: string;
      } = null;
  if (isAdmin) {
    try {
      const lb = await query<{
        id: string;
        created_at: string;
        status: string;
        filename: string | null;
        location: string;
        drive_file_id: string | null;
      }>(
        `SELECT id, created_at, status, filename, location, drive_file_id
         FROM backups
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`
      );
      const r = lb.rows[0];
      if (r) {
        const drive_uploaded =
          (r.location === "both" || r.location === "drive") && !!r.drive_file_id;
        last_backup = {
          id: r.id,
          created_at: r.created_at,
          status: r.status,
          filename: r.filename,
          drive_uploaded,
        };
      }
    } catch (e) {
      console.warn("[dashboard] last_backup skipped:", e);
    }
  }

  let bandwidth_by_day: { date: string; gb: number }[] = [];
  if (radiusOk) {
    try {
      const { rows: bw } = await query<{ d: string; gb: string }>(
        `SELECT u.usage_date::text AS d, coalesce(sum(u.used_gb), 0)::text AS gb
         FROM user_usage_daily u
         INNER JOIN subscribers s ON lower(btrim(s.username)) = lower(btrim(u.username)) AND s.tenant_id = $2
         WHERE u.usage_date >= (CURRENT_DATE - ($1::int))
         GROUP BY u.usage_date
         ORDER BY u.usage_date`,
        [revenueDays, dashTid]
      );
      bandwidth_by_day = bw.map((r) => ({ date: r.d, gb: Number(r.gb) }));
    } catch (e) {
      console.warn("[dashboard] bandwidth series skipped:", e);
    }
  }

  res.json({
    total_users: Number(users.rows[0]?.c ?? 0),
    active_users: Number(active.rows[0]?.c ?? 0),
    expired_users: Number(expired.rows[0]?.c ?? 0),
    revenue_30d: Number(revenue.rows[0]?.total ?? 0),
    revenue_month_growth_pct: growthPct,
    payments_by_day: paymentsSeries.rows.map((r) => ({ date: r.d, amount: Number(r.amount) })),
    subscribers_by_day: subscriberGrowth.rows.map((r) => ({ date: r.d, count: Number(r.c) })),
    /** RADIUS accounting (radacct + optional user_usage_daily rollup) */
    active_radius_sessions: Number(activeRadius.rows[0]?.c ?? 0),
    /** Sessions with acctstarttime today — approximate “today traffic” (see docs) */
    usage_today_gb: Number(usageToday.rows[0]?.gb ?? 0),
    top_users_radacct_total_gb: topUsersLifetime.rows.map((r) => ({
      username: r.username,
      gb: Number(r.gb),
    })),
    top_users_last_7d_rollup_gb: topUsers7dRollup.rows.map((r) => ({
      username: r.username,
      gb: Number(r.gb),
    })),
    usage_rollup_utc_today_gb: Number(rollupUtcToday.rows[0]?.gb ?? 0),
    /** Daily GB from user_usage_daily (populated by aggregate job) */
    bandwidth_by_day: bandwidth_by_day,
    radius_accounting_ready: radiusOk,
    ...(isAdmin ? { last_backup } : {}),
  });
});

export default router;
