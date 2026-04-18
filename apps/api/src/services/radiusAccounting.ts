import { radiusAccountingTablesExist } from "../db/ensureRadiusSchema.js";
import { query } from "../db/pool.js";
import { updateUsageCache } from "./accounting.service.js";
import { disconnectAllOpenSessions } from "./coa.service.js";
import { disableUser } from "./radius.service.js";

export { getUserUsage as getUserUsageGb } from "./accounting.service.js";
export type { UsageBreakdown } from "./accounting.service.js";

/**
 * Push `user_usage_live` aggregates into subscribers.data_used_gb / data_remaining_gb (GiB).
 */
export async function syncSubscribersFromRadacct(): Promise<void> {
  if (!(await radiusAccountingTablesExist())) return;
  await query(`
    WITH agg AS (
      SELECT uul.tenant_id,
             lower(btrim(uul.username)) AS lu,
             (COALESCE(uul.input_bytes, 0) + COALESCE(uul.output_bytes, 0))::numeric AS octets
      FROM user_usage_live uul
    )
    UPDATE subscribers s
    SET
      data_used_gb = COALESCE(agg.octets, 0) / POWER(1024::numeric, 3),
      data_remaining_gb = CASE
        WHEN s.package_id IS NULL THEN s.data_remaining_gb
        WHEN (SELECT pl.data_limit_gb FROM packages pl WHERE pl.id = s.package_id) IS NULL THEN NULL
        ELSE GREATEST(
          0,
          (SELECT pl.data_limit_gb FROM packages pl WHERE pl.id = s.package_id)
            - (COALESCE(agg.octets, 0) / POWER(1024::numeric, 3))
        )
      END,
      last_accounting_at = now(),
      updated_at = now()
    FROM agg
    WHERE s.tenant_id = agg.tenant_id AND lower(btrim(s.username)) = agg.lu
  `);

  await query(`
    UPDATE subscribers s
    SET
      data_used_gb = 0,
      data_remaining_gb = CASE
        WHEN s.package_id IS NULL THEN s.data_remaining_gb
        WHEN p.data_limit_gb IS NULL THEN NULL
        ELSE p.data_limit_gb
      END,
      last_accounting_at = now(),
      updated_at = now()
    FROM packages p
    WHERE s.package_id = p.id
      AND NOT EXISTS (
        SELECT 1 FROM radacct r
        WHERE r.username IS NOT NULL AND btrim(r.username) <> ''
          AND lower(btrim(r.username)) = lower(btrim(s.username))
      )
  `);
}

export type EnforceResult = { disabled_usernames: string[] };

/**
 * If quota exceeded or subscription time ended: CoA disconnect, remove RADIUS rows, mark subscriber disabled.
 */
export async function enforceLimitsFromSubscribers(): Promise<EnforceResult> {
  if (!(await radiusAccountingTablesExist())) return { disabled_usernames: [] };
  const { rows: victims } = await query<{ username: string }>(
    `SELECT s.username
     FROM subscribers s
     LEFT JOIN packages p ON p.id = s.package_id
     WHERE s.status <> 'disabled'
       AND (
         (s.expires_at IS NOT NULL AND s.expires_at < now())
         OR (
           p.data_limit_gb IS NOT NULL
           AND s.data_remaining_gb IS NOT NULL
           AND s.data_remaining_gb <= 0
         )
       )`
  );
  if (!victims.length) return { disabled_usernames: [] };

  const names = victims.map((v) => v.username);
  for (const uname of names) {
    try {
      await disconnectAllOpenSessions(uname);
    } catch (e) {
      console.warn("[enforce] CoA disconnect failed for", uname, e);
    }
    await disableUser(uname);
  }

  await query(
    `UPDATE subscribers
     SET status = 'disabled', updated_at = now()
     WHERE username = ANY($1::text[])`,
    [names]
  );

  return { disabled_usernames: names };
}

/** Roll up closed sessions into user_usage_daily (UTC day) for yesterday — safe to re-run (overwrites row). */
export async function aggregateUserUsageDailyYesterday(): Promise<void> {
  if (!(await radiusAccountingTablesExist())) return;
  await query(`
    INSERT INTO user_usage_daily (username, usage_date, used_gb, input_bytes, output_bytes)
    SELECT z.username,
           z.usage_date,
           SUM(z.bytes) / POWER(1024::double precision, 3),
           SUM(z.ib)::bigint,
           SUM(z.ob)::bigint
    FROM (
      SELECT btrim(r.username) AS username,
             (r.acctstoptime AT TIME ZONE 'UTC')::date AS usage_date,
             (COALESCE(r.acctinputoctets, 0) + COALESCE(r.acctoutputoctets, 0))::double precision AS bytes,
             COALESCE(r.acctinputoctets, 0)::bigint AS ib,
             COALESCE(r.acctoutputoctets, 0)::bigint AS ob
      FROM radacct r
      WHERE r.acctstoptime IS NOT NULL
        AND (r.acctstoptime AT TIME ZONE 'UTC')::date
            = ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - INTERVAL '1 day')::date
        AND r.username IS NOT NULL AND btrim(r.username) <> ''
    ) z
    GROUP BY z.username, z.usage_date
    ON CONFLICT (username, usage_date) DO UPDATE
    SET used_gb = EXCLUDED.used_gb,
        input_bytes = EXCLUDED.input_bytes,
        output_bytes = EXCLUDED.output_bytes,
        updated_at = now()
  `);
}

export async function radiusAccountingCycle(): Promise<{ synced: true; enforce: EnforceResult }> {
  await updateUsageCache();
  await syncSubscribersFromRadacct();
  const enforce = await enforceLimitsFromSubscribers();
  return { synced: true, enforce };
}
