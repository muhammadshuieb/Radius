import dgram from "node:dgram";
import { randomBytes } from "node:crypto";
import { DEFAULT_TENANT_ID } from "../constants/tenant.js";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { getCoaPortForNasIp, resolveSecretForNasIp } from "./nas.service.js";

/** RADIUS codes (RFC 5176 CoA) */
const DISCONNECT_REQUEST = 40;
const DISCONNECT_ACK = 41;
const DISCONNECT_NAK = 42;

/** Common attribute types */
const ATTR_USER_NAME = 1;
const ATTR_NAS_IP_ADDRESS = 4;
const ATTR_ACCT_SESSION_ID = 44;

function encodeStringAttr(type: number, value: string): Buffer {
  const v = Buffer.from(value, "utf8");
  const len = 2 + v.length;
  const buf = Buffer.alloc(len);
  buf.writeUInt8(type, 0);
  buf.writeUInt8(len, 1);
  v.copy(buf, 2);
  return buf;
}

function encodeNasIp(ip: string): Buffer | null {
  const parts = ip.split(".").map((x) => Number(x.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  const buf = Buffer.alloc(6);
  buf.writeUInt8(ATTR_NAS_IP_ADDRESS, 0);
  buf.writeUInt8(6, 1);
  for (let i = 0; i < 4; i++) buf.writeUInt8(parts[i], 2 + i);
  return buf;
}

function buildDisconnectPacket(username: string, nasIp: string, acctSessionId?: string | null): Buffer {
  const id = randomBytes(1)[0]!;
  const auth = randomBytes(16);
  const attrs: Buffer[] = [encodeStringAttr(ATTR_USER_NAME, username)];
  const nas = encodeNasIp(nasIp);
  if (nas) attrs.push(nas);
  if (acctSessionId?.trim()) {
    attrs.push(encodeStringAttr(ATTR_ACCT_SESSION_ID, acctSessionId.trim()));
  }
  const body = Buffer.concat(attrs);
  const length = 20 + body.length;
  if (length > 4096) throw new Error("RADIUS packet too large");
  const pkt = Buffer.alloc(length);
  pkt.writeUInt8(DISCONNECT_REQUEST, 0);
  pkt.writeUInt8(id, 1);
  pkt.writeUInt16BE(length, 2);
  auth.copy(pkt, 4);
  body.copy(pkt, 20);
  return pkt;
}

async function resolveNasSecret(nasIp: string, tenantId?: string): Promise<string | null> {
  const tid = tenantId ?? DEFAULT_TENANT_ID;
  const fromInventory = await resolveSecretForNasIp(nasIp, tid);
  if (fromInventory) return fromInventory;
  try {
    const { rows } = await query<{ secret: string }>(
      `SELECT secret FROM nas WHERE trim(both from nasname) = trim(both from $1) LIMIT 1`,
      [nasIp]
    );
    if (rows[0]?.secret) return rows[0].secret;
  } catch {
    /* nas table may be absent in minimal installs */
  }
  const env = config.radiusCoaSecret?.trim();
  return env || null;
}

export type DisconnectResult = {
  ok: boolean;
  nas_ip: string;
  detail?: string;
  response_code?: number;
};

/**
 * Send RADIUS Disconnect-Request (UDP port 3799) to the NAS.
 * Secret is used only for validating responses in full RADIUS stacks; many NAS accept request without Response-Auth check.
 */
export async function disconnectUser(
  username: string,
  framedIp: string | null | undefined,
  nasIp: string,
  tenantId?: string
): Promise<DisconnectResult> {
  const u = username.trim();
  if (!u || !nasIp.trim()) {
    return { ok: false, nas_ip: nasIp, detail: "username and nas_ip required" };
  }
  void framedIp;
  const tid = tenantId ?? DEFAULT_TENANT_ID;

  const { rows } = await query<{ acctsessionid: string | null }>(
    `SELECT acctsessionid
     FROM radacct
     WHERE lower(btrim(username)) = lower(btrim($1))
       AND acctstoptime IS NULL
       AND host(nasipaddress)::text = $2
     ORDER BY acctstarttime DESC NULLS LAST
     LIMIT 1`,
    [u, nasIp.trim()]
  );
  const sid = rows[0]?.acctsessionid ?? null;

  const secret = await resolveNasSecret(nasIp.trim(), tid);
  if (!secret) {
    return {
      ok: false,
      nas_ip: nasIp,
      detail: "No RADIUS secret: add NAS in inventory, nas.secret (DMA), or RADIUS_COA_SECRET",
    };
  }
  void secret;

  const pkt = buildDisconnectPacket(u, nasIp.trim(), sid);

  const port = (await getCoaPortForNasIp(nasIp.trim(), tid)) ?? config.radiusCoaPort;
  const client = dgram.createSocket("udp4");

  return await new Promise<DisconnectResult>((resolve) => {
    const timer = setTimeout(() => {
      try {
        client.close();
      } catch {
        /* ignore */
      }
      resolve({ ok: false, nas_ip: nasIp, detail: "UDP timeout (2s)" });
    }, 2000);

    client.once("message", (msg) => {
      clearTimeout(timer);
      try {
        client.close();
      } catch {
        /* ignore */
      }
      const code = msg.readUInt8(0);
      resolve({
        ok: code === DISCONNECT_ACK,
        nas_ip: nasIp,
        response_code: code,
        detail: code === DISCONNECT_NAK ? "Disconnect-NAK" : code === DISCONNECT_ACK ? "Disconnect-ACK" : `code ${code}`,
      });
    });

    client.once("error", (err) => {
      clearTimeout(timer);
      try {
        client.close();
      } catch {
        /* ignore */
      }
      resolve({ ok: false, nas_ip: nasIp, detail: err.message });
    });

    client.send(pkt, port, nasIp.trim(), (err) => {
      if (err) {
        clearTimeout(timer);
        try {
          client.close();
        } catch {
          /* ignore */
        }
        resolve({ ok: false, nas_ip: nasIp, detail: err.message });
      }
    });
  });
}

/**
 * Best-effort CoA disconnect for all open sessions of a user (each NAS IP).
 */
export async function disconnectAllOpenSessions(username: string): Promise<DisconnectResult[]> {
  const { rows: sub } = await query<{ tenant_id: string | null }>(
    `SELECT tenant_id::text AS tenant_id FROM subscribers WHERE lower(btrim(username)) = lower(btrim($1)) LIMIT 1`,
    [username.trim()]
  );
  const tid = sub[0]?.tenant_id ?? DEFAULT_TENANT_ID;
  const { rows } = await query<{ nas: string }>(
    `SELECT host(nasipaddress)::text AS nas
     FROM radacct
     WHERE lower(btrim(username)) = lower(btrim($1)) AND acctstoptime IS NULL
     GROUP BY 1`,
    [username.trim()]
  );
  const out: DisconnectResult[] = [];
  for (const r of rows) {
    out.push(await disconnectUser(username, null, r.nas, tid));
  }
  return out;
}
