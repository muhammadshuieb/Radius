import { DEFAULT_TENANT_ID } from "../constants/tenant.js";
import { radiusAccountingTablesExist } from "../db/ensureRadiusSchema.js";
import { query } from "../db/pool.js";

const BYTES_PER_GB = 1024 ** 3;

export type UsageBreakdown = {
  username: string;
  input_octets: string;
  output_octets: string;
  input_gb: number;
  output_gb: number;
  total_gb: number;
};

/**
 * Hot path: read pre-aggregated `user_usage_live` (filled every minute by worker).
 * Falls back to radacct SUM only if cache row is missing.
 */
export async function getUserUsage(username: string, tenantId = DEFAULT_TENANT_ID): Promise<UsageBreakdown> {
  const u = username.trim();
  if (!(await radiusAccountingTablesExist()) || !u) {
    return emptyUsage(u);
  }
  const { rows: live } = await query<{ ib: string; ob: string }>(
    `SELECT input_bytes::text AS ib, output_bytes::text AS ob
     FROM user_usage_live
     WHERE tenant_id = $1 AND lower(btrim(username)) = lower(btrim($2))`,
    [tenantId, u]
  );
  if (live[0]) {
    const input = Number(live[0].ib ?? 0);
    const output = Number(live[0].ob ?? 0);
    const totalBytes = input + output;
    return {
      username: u,
      input_octets: String(input),
      output_octets: String(output),
      input_gb: input / BYTES_PER_GB,
      output_gb: output / BYTES_PER_GB,
      total_gb: totalBytes / BYTES_PER_GB,
    };
  }
  return fallbackSumRadacct(u);
}

function emptyUsage(username: string): UsageBreakdown {
  return {
    username,
    input_octets: "0",
    output_octets: "0",
    input_gb: 0,
    output_gb: 0,
    total_gb: 0,
  };
}

async function fallbackSumRadacct(username: string): Promise<UsageBreakdown> {
  const { rows } = await query<{ input: string; output: string }>(
    `SELECT COALESCE(SUM(acctinputoctets), 0)::text AS input,
            COALESCE(SUM(acctoutputoctets), 0)::text AS output
     FROM radacct
     WHERE lower(btrim(username)) = lower(btrim($1))`,
    [username]
  );
  const input = Number(rows[0]?.input ?? 0);
  const output = Number(rows[0]?.output ?? 0);
  const totalBytes = input + output;
  return {
    username,
    input_octets: String(input),
    output_octets: String(output),
    input_gb: input / BYTES_PER_GB,
    output_gb: output / BYTES_PER_GB,
    total_gb: totalBytes / BYTES_PER_GB,
  };
}

/**
 * One global aggregate per minute (worker) — avoids per-request SUM on radacct.
 */
export async function updateUsageCache(): Promise<void> {
  if (!(await radiusAccountingTablesExist())) return;
  await query(
    `
    INSERT INTO user_usage_live (tenant_id, username, input_bytes, output_bytes, updated_at)
    SELECT COALESCE(s.tenant_id, $1::uuid),
           lower(btrim(r.username)),
           SUM(COALESCE(r.acctinputoctets, 0))::bigint,
           SUM(COALESCE(r.acctoutputoctets, 0))::bigint,
           now()
    FROM radacct r
    LEFT JOIN subscribers s ON lower(btrim(s.username)) = lower(btrim(r.username))
    WHERE r.username IS NOT NULL AND btrim(r.username) <> ''
    GROUP BY 1, 2
    ON CONFLICT (tenant_id, username) DO UPDATE SET
      input_bytes = EXCLUDED.input_bytes,
      output_bytes = EXCLUDED.output_bytes,
      updated_at = EXCLUDED.updated_at
    `,
    [DEFAULT_TENANT_ID]
  );
}

export type TopUserRow = {
  username: string;
  tenant_id: string;
  total_bytes: string;
  input_bytes: string;
  output_bytes: string;
};

export async function getTopUsers(limit = 10, tenantId?: string): Promise<TopUserRow[]> {
  if (!(await radiusAccountingTablesExist())) return [];
  const tid = tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await query<TopUserRow>(
    `SELECT username::text AS username,
            tenant_id::text AS tenant_id,
            (input_bytes + output_bytes)::text AS total_bytes,
            input_bytes::text AS input_bytes,
            output_bytes::text AS output_bytes
     FROM user_usage_live
     WHERE tenant_id = $1
     ORDER BY (input_bytes + output_bytes) DESC
     LIMIT $2`,
    [tid, limit]
  );
  return rows;
}
