import { DEFAULT_TENANT_ID } from "../constants/tenant.js";
import { radiusAccountingTablesExist } from "../db/ensureRadiusSchema.js";
import { query } from "../db/pool.js";

const MAC_ATTR = "Calling-Station-Id";
const IP_ATTR = "Framed-IP-Address";
const POOL_ATTR = "Framed-Pool";
const PASS_ATTR = "Cleartext-Password";
/** DMA / legacy systems often store MD5(hex) in DB; FreeRADIUS uses MD5-Password attribute. */
const MD5_PASS_ATTR = "MD5-Password";

async function tenantIdFor(username: string): Promise<string> {
  const u = username.trim();
  const { rows } = await query<{ tid: string | null }>(
    `SELECT tenant_id::text AS tid FROM subscribers WHERE lower(btrim(username)) = lower(btrim($1)) LIMIT 1`,
    [u]
  );
  return rows[0]?.tid ?? DEFAULT_TENANT_ID;
}

/**
 * Idempotent RADIUS auth row — Cleartext-Password for FreeRADIUS users file / SQL module.
 * Removes duplicate Cleartext-Password rows for this username, then inserts one.
 */
export async function syncRadcheckPassword(username: string, plainPassword: string): Promise<void> {
  if (!(await radiusAccountingTablesExist())) return;
  const u = username.trim();
  if (!u || !plainPassword) return;
  const tid = await tenantIdFor(u);
  await query(
    `DELETE FROM radcheck WHERE tenant_id = $1 AND lower(btrim(username)) = lower(btrim($2)) AND attribute = ANY($3::text[])`,
    [tid, u, [PASS_ATTR, MD5_PASS_ATTR]]
  );
  await query(
    `INSERT INTO radcheck (username, attribute, op, value, tenant_id) VALUES ($1, $2, ':=', $3, $4)`,
    [u, PASS_ATTR, plainPassword, tid]
  );
}

/**
 * DMA Radius Manager: password column is often MD5 hex (32 chars). Use MD5-Password in radcheck.
 * Clears Cleartext-Password for this user so MD5 auth applies.
 */
export async function syncRadcheckMd5Password(username: string, md5HexLowercase: string): Promise<void> {
  if (!(await radiusAccountingTablesExist())) return;
  const u = username.trim();
  if (!u || !md5HexLowercase) return;
  const tid = await tenantIdFor(u);
  await query(
    `DELETE FROM radcheck WHERE tenant_id = $1 AND lower(btrim(username)) = lower(btrim($2)) AND attribute = ANY($3::text[])`,
    [tid, u, [PASS_ATTR, MD5_PASS_ATTR]]
  );
  await query(`INSERT INTO radcheck (username, attribute, op, value, tenant_id) VALUES ($1, $2, ':=', $3, $4)`, [
    u,
    MD5_PASS_ATTR,
    md5HexLowercase.toLowerCase(),
    tid,
  ]);
}

type Locks = { mac_lock: string | null; ip_lock: string | null; ip_pool: string | null };

/**
 * Sync MAC lock (radcheck), static IP and pool (radreply). Clears attribute rows when value is null/empty.
 */
export async function syncRadiusLocks(username: string, locks: Locks): Promise<void> {
  if (!(await radiusAccountingTablesExist())) return;
  const u = username.trim();
  if (!u) return;
  const tid = await tenantIdFor(u);

  const mac = locks.mac_lock?.trim() || null;
  await query(
    `DELETE FROM radcheck WHERE tenant_id = $1 AND lower(btrim(username)) = lower(btrim($2)) AND attribute = $3`,
    [tid, u, MAC_ATTR]
  );
  if (mac) {
    await query(
      `INSERT INTO radcheck (username, attribute, op, value, tenant_id) VALUES ($1, $2, '==', $3, $4)`,
      [u, MAC_ATTR, mac, tid]
    );
  }

  await query(
    `DELETE FROM radreply WHERE tenant_id = $1 AND lower(btrim(username)) = lower(btrim($2)) AND (attribute = $3 OR attribute = $4)`,
    [tid, u, IP_ATTR, POOL_ATTR]
  );
  const ip = locks.ip_lock?.trim() || null;
  const pool = locks.ip_pool?.trim() || null;
  if (ip) {
    await query(
      `INSERT INTO radreply (username, attribute, op, value, tenant_id) VALUES ($1, $2, '=', $3, $4)`,
      [u, IP_ATTR, ip, tid]
    );
  }
  if (pool) {
    await query(
      `INSERT INTO radreply (username, attribute, op, value, tenant_id) VALUES ($1, $2, '=', $3, $4)`,
      [u, POOL_ATTR, pool, tid]
    );
  }
}
