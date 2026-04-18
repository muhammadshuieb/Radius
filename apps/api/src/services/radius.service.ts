import { DEFAULT_TENANT_ID } from "../constants/tenant.js";
import { radiusAccountingTablesExist } from "../db/ensureRadiusSchema.js";
import { query } from "../db/pool.js";
import { syncRadcheckPassword } from "./radiusSubscriberSync.js";

const RATE_ATTR = "Mikrotik-Rate-Limit";
const IP_ATTR = "Framed-IP-Address";
const POOL_ATTR = "Framed-Pool";
const MAC_ATTR = "Calling-Station-Id";

export type RadiusLimits = {
  /** Download / upload burst, e.g. "10M/10M" */
  rateLimit?: string | null;
};

async function tenantForUsername(username: string): Promise<string> {
  const u = username.trim();
  if (!u) return DEFAULT_TENANT_ID;
  const { rows } = await query<{ tid: string | null }>(
    `SELECT tenant_id::text AS tid FROM subscribers WHERE lower(btrim(username)) = lower(btrim($1)) LIMIT 1`,
    [u]
  );
  return rows[0]?.tid ?? DEFAULT_TENANT_ID;
}

/**
 * Idempotent: Cleartext-Password + optional Mikrotik-Rate-Limit; `profile` reserved for future group mapping.
 */
export async function createUser(
  username: string,
  password: string,
  _profile: string | null,
  limits: RadiusLimits | null
): Promise<void> {
  await syncRadcheckPassword(username, password);
  if (limits?.rateLimit?.trim()) {
    await setRateLimit(username, limits.rateLimit.trim());
  }
}

/** Remove all auth/reply rows for this subscriber (same effect as quota/expiry enforcement). */
export async function disableUser(username: string): Promise<void> {
  if (!(await radiusAccountingTablesExist())) return;
  const u = username.trim();
  if (!u) return;
  const tid = await tenantForUsername(u);
  await query(
    `DELETE FROM radcheck WHERE tenant_id = $1 AND lower(btrim(username)) = lower(btrim($2))`,
    [tid, u]
  );
  await query(
    `DELETE FROM radreply WHERE tenant_id = $1 AND lower(btrim(username)) = lower(btrim($2))`,
    [tid, u]
  );
}

/** Restore access — requires cleartext password because disable removes auth rows. */
export async function enableUser(username: string, password: string): Promise<void> {
  await createUser(username, password, null, null);
}

export async function setRateLimit(username: string, speed: string): Promise<void> {
  if (!(await radiusAccountingTablesExist())) return;
  const u = username.trim();
  if (!u) return;
  const tid = await tenantForUsername(u);
  await query(
    `DELETE FROM radreply WHERE tenant_id = $1 AND lower(btrim(username)) = lower(btrim($2)) AND attribute = $3`,
    [tid, u, RATE_ATTR]
  );
  await query(
    `INSERT INTO radreply (username, attribute, op, value, tenant_id) VALUES ($1, $2, '=', $3, $4)`,
    [u, RATE_ATTR, speed, tid]
  );
}

export async function setIP(username: string, ip: string): Promise<void> {
  if (!(await radiusAccountingTablesExist())) return;
  const u = username.trim();
  if (!u) return;
  const tid = await tenantForUsername(u);
  await query(
    `DELETE FROM radreply WHERE tenant_id = $1 AND lower(btrim(username)) = lower(btrim($2)) AND attribute = $3`,
    [tid, u, IP_ATTR]
  );
  await query(
    `INSERT INTO radreply (username, attribute, op, value, tenant_id) VALUES ($1, $2, '=', $3, $4)`,
    [u, IP_ATTR, ip.trim(), tid]
  );
}

export async function setMAC(username: string, mac: string): Promise<void> {
  if (!(await radiusAccountingTablesExist())) return;
  const u = username.trim();
  if (!u) return;
  const tid = await tenantForUsername(u);
  await query(
    `DELETE FROM radcheck WHERE tenant_id = $1 AND lower(btrim(username)) = lower(btrim($2)) AND attribute = $3`,
    [tid, u, MAC_ATTR]
  );
  await query(
    `INSERT INTO radcheck (username, attribute, op, value, tenant_id) VALUES ($1, $2, '==', $3, $4)`,
    [u, MAC_ATTR, mac.trim(), tid]
  );
}

export async function assignPool(username: string, pool: string): Promise<void> {
  if (!(await radiusAccountingTablesExist())) return;
  const u = username.trim();
  if (!u) return;
  const tid = await tenantForUsername(u);
  await query(
    `DELETE FROM radreply WHERE tenant_id = $1 AND lower(btrim(username)) = lower(btrim($2)) AND attribute = $3`,
    [tid, u, POOL_ATTR]
  );
  await query(
    `INSERT INTO radreply (username, attribute, op, value, tenant_id) VALUES ($1, $2, '=', $3, $4)`,
    [u, POOL_ATTR, pool.trim(), tid]
  );
}
