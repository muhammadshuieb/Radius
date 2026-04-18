import dgram from "node:dgram";
import net from "node:net";
import { DEFAULT_TENANT_ID } from "../constants/tenant.js";
import { query } from "../db/pool.js";
import { decryptField, encryptField } from "../lib/fieldCrypto.js";
import { broadcast } from "../ws/broadcast.js";

const RADIUS_AUTH_PORT = 1812;

export type NasHealthStatus = "online" | "degraded" | "offline" | "unknown";

export type NasRow = {
  id: string;
  tenant_id: string;
  name: string;
  ip_address: string;
  coa_port: number;
  api_port: number | null;
  location: string | null;
  status: NasHealthStatus;
  last_seen: string | null;
  active_sessions_count: number;
  created_at: string;
};

export type NasRowPublic = NasRow & {
  /** Never returned to client — use only server-side */
  radius_secret_enc?: string;
};

export type PingResult = { ok: boolean; detail?: string; ms?: number };

/**
 * TCP reachability (RADIUS auth is often UDP-only; this is a best-effort "path up" check).
 */
export function tcpReachable(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

/**
 * Ping NAS: try TCP to RADIUS auth port, CoA port, then API port (MikroTik-style).
 */
export async function pingNAS(
  ip: string,
  opts: { coaPort?: number; apiPort?: number | null } = {}
): Promise<PingResult> {
  const host = ip.trim();
  if (!host) return { ok: false, detail: "empty ip" };
  const coaP = opts.coaPort ?? 3799;
  const apiP = opts.apiPort ?? null;
  const started = Date.now();
  if (await tcpReachable(host, RADIUS_AUTH_PORT)) {
    return { ok: true, ms: Date.now() - started, detail: `tcp:${RADIUS_AUTH_PORT}` };
  }
  if (await tcpReachable(host, coaP)) {
    return { ok: true, ms: Date.now() - started, detail: `tcp:${coaP}` };
  }
  if (apiP != null && (await tcpReachable(host, apiP))) {
    return { ok: true, ms: Date.now() - started, detail: `tcp:${apiP}` };
  }
  if (await tcpReachable(host, 8728)) {
    return { ok: true, ms: Date.now() - started, detail: "tcp:8728" };
  }
  return { ok: false, detail: "no TCP port responded (NAS may be UDP-only RADIUS)" };
}

/** RADIUS: treat TCP/1812 open as "auth path reachable" (many NAS use UDP-only — then ping may be false but CoA still works). */
export async function checkRadius(nas: { ip_address: string }): Promise<boolean> {
  return tcpReachable(String(nas.ip_address).trim(), RADIUS_AUTH_PORT, 1500);
}

/** Minimal UDP probe to CoA port — any reply counts as CoA stack alive. */
export async function checkCoA(nas: {
  ip_address: string;
  coa_port: number;
  radius_secret_enc: string;
}): Promise<boolean> {
  const host = String(nas.ip_address).trim();
  const port = nas.coa_port || 3799;
  try {
    const s = decryptField(nas.radius_secret_enc);
    if (!s) return false;
  } catch {
    return false;
  }

  const id = Math.floor(Math.random() * 256);
  const auth = Buffer.alloc(16, 0);
  const body = Buffer.alloc(0);
  const len = 20 + body.length;
  const pkt = Buffer.alloc(len);
  pkt.writeUInt8(40, 0);
  pkt.writeUInt8(id, 1);
  pkt.writeUInt16BE(len, 2);
  auth.copy(pkt, 4);

  const client = dgram.createSocket("udp4");
  return await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => {
      try {
        client.close();
      } catch {
        /* ignore */
      }
      resolve(false);
    }, 2000);
    client.once("message", () => {
      clearTimeout(t);
      try {
        client.close();
      } catch {
        /* ignore */
      }
      resolve(true);
    });
    client.once("error", () => {
      clearTimeout(t);
      resolve(false);
    });
    client.send(pkt, port, host, (err) => {
      if (err) {
        clearTimeout(t);
        try {
          client.close();
        } catch {
          /* ignore */
        }
        resolve(false);
      }
    });
  });
}

function computeOverallStatus(pingOk: boolean, radiusOk: boolean, coaOk: boolean): NasHealthStatus {
  const reachable = pingOk || radiusOk || coaOk;
  if (!reachable) return "offline";
  if (pingOk && radiusOk && coaOk) return "online";
  return "degraded";
}

export async function refreshActiveSessionCounts(): Promise<void> {
  await query(`UPDATE nas_servers SET active_sessions_count = 0`);
  await query(`
    UPDATE nas_servers n
    SET active_sessions_count = COALESCE(sub.c, 0)
    FROM (
      SELECT r.tenant_id AS tid,
             host(r.nasipaddress)::text AS nip,
             COUNT(*)::int AS c
      FROM radacct r
      WHERE r.acctstoptime IS NULL
      GROUP BY r.tenant_id, host(r.nasipaddress)::text
    ) sub
    WHERE n.tenant_id = sub.tid
      AND host(n.ip_address)::text = sub.nip
  `);
}

/**
 * Run probes and persist status + last_seen. Emits WebSocket + offline alerts on transition.
 */
export async function updateNASStatus(nasId: string): Promise<{
  status: NasHealthStatus;
  ping: PingResult;
  radius_ok: boolean;
  coa_ok: boolean;
}> {
  const { rows } = await query<{
    id: string;
    tenant_id: string;
    ip_address: string;
    coa_port: number;
    api_port: number | null;
    radius_secret_enc: string;
    status: NasHealthStatus;
  }>(
    `SELECT id, tenant_id, host(ip_address)::text AS ip_address, coa_port, api_port, radius_secret_enc, status::text AS status
     FROM nas_servers WHERE id = $1`,
    [nasId]
  );
  const row = rows[0];
  if (!row) {
    return { status: "unknown", ping: { ok: false }, radius_ok: false, coa_ok: false };
  }

  const { status: next, ping, radius_ok, coa_ok } = await probeNasRow(row);
  const prev = row.status;

  await query(`UPDATE nas_servers SET status = $1::text, last_seen = now() WHERE id = $2`, [next, nasId]);

  if (prev !== "offline" && next === "offline") {
    await query(
      `INSERT INTO nas_alert_log (tenant_id, nas_id, kind, message)
       VALUES ($1, $2, 'offline', $3)`,
      [row.tenant_id, nasId, `NAS ${row.ip_address} reported offline`]
    );
    console.warn(`[nas] OFFLINE nas_id=${nasId} ip=${row.ip_address}`);
  }

  broadcast("nas.updated", { nas_id: nasId, tenant_id: row.tenant_id, status: next, at: new Date().toISOString() });
  if (prev !== "offline" && next === "offline") {
    broadcast("nas.alert", {
      kind: "offline",
      nas_id: nasId,
      tenant_id: row.tenant_id,
      message: `NAS ${row.ip_address} is offline`,
    });
  }

  return { status: next, ping, radius_ok, coa_ok };
}

export async function runNasHealthCheckAll(): Promise<void> {
  await refreshActiveSessionCounts();
  const { rows } = await query<{ id: string }>(`SELECT id FROM nas_servers ORDER BY name`);
  for (const r of rows) {
    try {
      await updateNASStatus(r.id);
    } catch (e) {
      console.warn("[nas] health check failed for", r.id, e);
    }
  }
}

export function encryptNasSecret(plain: string): string {
  return encryptField(plain);
}

export function decryptNasSecret(stored: string): string {
  return decryptField(stored);
}

export async function listNasForTenant(tenantId: string): Promise<NasRow[]> {
  const { rows } = await query<NasRow>(
    `SELECT id, tenant_id, name, host(ip_address)::text AS ip_address, coa_port, api_port, location,
            status::text AS status, last_seen::text AS last_seen, active_sessions_count, created_at::text AS created_at
     FROM nas_servers WHERE tenant_id = $1 ORDER BY name`,
    [tenantId]
  );
  return rows;
}

export async function getNasById(id: string, tenantId: string): Promise<NasRow | null> {
  const { rows } = await query<NasRow>(
    `SELECT id, tenant_id, name, host(ip_address)::text AS ip_address, coa_port, api_port, location,
            status::text AS status, last_seen::text AS last_seen, active_sessions_count, created_at::text AS created_at
     FROM nas_servers WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  return rows[0] ?? null;
}

export async function getNasRowWithSecret(id: string, tenantId: string) {
  const { rows } = await query<{
    id: string;
    tenant_id: string;
    ip_address: string;
    coa_port: number;
    api_port: number | null;
    radius_secret_enc: string;
  }>(
    `SELECT id, tenant_id, host(ip_address)::text AS ip_address, coa_port, api_port, radius_secret_enc
     FROM nas_servers WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  return rows[0] ?? null;
}

async function probeNasRow(row: {
  ip_address: string;
  coa_port: number;
  api_port: number | null;
  radius_secret_enc: string;
}): Promise<{
  status: NasHealthStatus;
  ping: PingResult;
  radius_ok: boolean;
  coa_ok: boolean;
}> {
  const ping = await pingNAS(row.ip_address, { coaPort: row.coa_port, apiPort: row.api_port });
  const radius_ok = await checkRadius({ ip_address: row.ip_address });
  const coa_ok = await checkCoA({
    ip_address: row.ip_address,
    coa_port: row.coa_port,
    radius_secret_enc: row.radius_secret_enc,
  });
  const next = computeOverallStatus(ping.ok, radius_ok, coa_ok);
  return { status: next, ping, radius_ok, coa_ok };
}

/** Read-only probes (POST /test) — does not persist status. */
export async function runNasHealthProbe(id: string, tenantId: string) {
  const row = await getNasRowWithSecret(id, tenantId);
  if (!row) return null;
  return probeNasRow(row);
}

/** Resolve RADIUS/CoA shared secret for an IP (prefers nas_servers for tenant). */
export async function resolveSecretForNasIp(nasIp: string, tenantId = DEFAULT_TENANT_ID): Promise<string | null> {
  const { rows } = await query<{ enc: string }>(
    `SELECT radius_secret_enc AS enc FROM nas_servers
     WHERE tenant_id = $1 AND host(ip_address)::text = trim(both from $2) LIMIT 1`,
    [tenantId, nasIp.trim()]
  );
  if (rows[0]?.enc) {
    try {
      return decryptField(rows[0].enc);
    } catch {
      return null;
    }
  }
  return null;
}

export async function getCoaPortForNasIp(nasIp: string, tenantId = DEFAULT_TENANT_ID): Promise<number | null> {
  const { rows } = await query<{ p: number }>(
    `SELECT coa_port AS p FROM nas_servers
     WHERE tenant_id = $1 AND host(ip_address)::text = trim(both from $2) LIMIT 1`,
    [tenantId, nasIp.trim()]
  );
  return rows[0]?.p ?? null;
}
