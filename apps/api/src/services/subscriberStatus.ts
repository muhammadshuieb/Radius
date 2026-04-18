import { DEFAULT_TENANT_ID } from "../constants/tenant.js";
import { config } from "../config.js";
import { radiusAccountingTablesExist } from "../db/ensureRadiusSchema.js";
import { query } from "../db/pool.js";
import { redisConnection } from "../queue/connection.js";

export type SubscriberLiveStatus = {
  is_online: boolean;
  current_ip: string | null;
  nas_name: string | null;
  nas_ip: string | null;
  last_logout_at: string | null;
  /** Start time of the current open session (if online). */
  session_start: string | null;
};

/**
 * Derive online/session info from radacct + MikroTik server name when radius tables exist.
 * Cached in Redis (short TTL) to avoid repeated joins under load.
 */
export async function getSubscriberStatus(
  username: string,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<SubscriberLiveStatus> {
  const empty: SubscriberLiveStatus = {
    is_online: false,
    current_ip: null,
    nas_name: null,
    nas_ip: null,
    last_logout_at: null,
    session_start: null,
  };
  if (!(await radiusAccountingTablesExist())) return empty;

  const u = username.trim();
  if (!u) return empty;

  const cacheKey = `substatus:${tenantId}:${u.toLowerCase()}`;
  try {
    const hit = await redisConnection.get(cacheKey);
    if (hit) {
      return JSON.parse(hit) as SubscriberLiveStatus;
    }
  } catch {
    /* Redis optional */
  }

  const { rows: openRows } = await query<{
    framedipaddress: string | null;
    nasipaddress: string | null;
    nas_name: string | null;
    session_start: string | null;
  }>(
    `SELECT r.framedipaddress::text AS framedipaddress,
            r.nasipaddress::text AS nasipaddress,
            ms.name AS nas_name,
            r.acctstarttime::text AS session_start
     FROM radacct r
     LEFT JOIN subscribers s ON lower(btrim(s.username)) = lower(btrim(r.username))
     LEFT JOIN mikrotik_servers ms ON trim(both from ms.host) = host(r.nasipaddress)::text
     WHERE lower(btrim(r.username)) = lower(btrim($1))
       AND (s.tenant_id IS NULL OR s.tenant_id = $2::uuid)
       AND r.acctstoptime IS NULL
     ORDER BY r.acctstarttime DESC NULLS LAST
     LIMIT 1`,
    [u, tenantId]
  );

  const { rows: loRows } = await query<{ last_lo: string | null }>(
    `SELECT max(r.acctstoptime)::text AS last_lo
     FROM radacct r
     LEFT JOIN subscribers s ON lower(btrim(s.username)) = lower(btrim(r.username))
     WHERE lower(btrim(r.username)) = lower(btrim($1))
       AND (s.tenant_id IS NULL OR s.tenant_id = $2::uuid)
       AND r.acctstoptime IS NOT NULL`,
    [u, tenantId]
  );

  const open = openRows[0];
  const lastLo = loRows[0]?.last_lo ?? null;

  const result: SubscriberLiveStatus = {
    is_online: !!open,
    current_ip: open?.framedipaddress ?? null,
    nas_ip: open?.nasipaddress ?? null,
    nas_name: open?.nas_name ?? null,
    last_logout_at: lastLo,
    session_start: open?.session_start ?? null,
  };

  try {
    await redisConnection.setex(cacheKey, config.subscriberCacheTtlSec, JSON.stringify(result));
  } catch {
    /* ignore */
  }

  return result;
}
