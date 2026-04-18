import { query } from "../db/pool.js";
import { syncRadcheckMd5Password, syncRadiusLocks } from "./radiusSubscriberSync.js";

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** DMA may store limits in bytes; negative often means “unlimited”. */
function bytesToDataGb(bytes: unknown): number | null {
  const n = num(bytes);
  if (n == null || n < 0) return null;
  return n / (1024 * 1024 * 1024);
}

function parseDmaExpiration(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    if (v > 1e12) return new Date(v);
    if (v > 1e9) return new Date(v * 1000);
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t);
    const n = Number(v);
    if (Number.isFinite(n)) {
      if (n > 1e12) return new Date(n);
      if (n > 1e9) return new Date(n * 1000);
    }
  }
  return null;
}

function isMd5Hex(s: string): boolean {
  return /^[a-f0-9]{32}$/i.test(s.trim());
}

export async function insertDmaStagingRows(rows: Record<string, unknown>[]): Promise<{ inserted: number }> {
  let n = 0;
  for (const data of rows) {
    await query(`INSERT INTO dma_import_staging (data) VALUES ($1::jsonb)`, [JSON.stringify(data)]);
    n += 1;
  }
  return { inserted: n };
}

export async function getDmaStagingStats(): Promise<{ pending: number; total: number }> {
  const { rows: t } = await query<{ c: string }>(`SELECT count(*)::text AS c FROM dma_import_staging`);
  const { rows: p } = await query<{ c: string }>(
    `SELECT count(*)::text AS c FROM dma_import_staging WHERE migrated_subscriber_id IS NULL`
  );
  return { total: Number(t[0]?.c ?? 0), pending: Number(p[0]?.c ?? 0) };
}

async function resolvePackageId(
  dmaGroupId: number | null,
  defaultPackageId: string,
  groupMap: Map<number, string>
): Promise<string> {
  if (dmaGroupId != null && groupMap.has(dmaGroupId)) {
    const id = groupMap.get(dmaGroupId)!;
    const { rows } = await query(`SELECT id FROM packages WHERE id = $1::uuid`, [id]);
    if (rows.length) return id;
  }
  const { rows } = await query(`SELECT id FROM packages WHERE id = $1::uuid`, [defaultPackageId]);
  if (!rows.length) throw new Error(`default_package_id not found: ${defaultPackageId}`);
  return defaultPackageId;
}

/**
 * Migrate one DMA rm_users-like row (JSON) into subscribers + customer_profiles.
 * Password: if 32-char hex, sync MD5-Password to radcheck (DMA-compatible RADIUS auth).
 */
export async function migrateOneDmaStagingRow(
  stagingId: number,
  data: Record<string, unknown>,
  defaultPackageId: string,
  groupMap: Map<number, string>
): Promise<void> {
  const username = String(data.username ?? "").trim();
  if (!username) throw new Error("missing username");

  const groupId = num(data.groupid);
  const packageId = await resolvePackageId(groupId, defaultPackageId, groupMap);

  const enable = num(data.enableuser);
  const status = enable === 0 ? "disabled" : "active";

  let expiresAt = parseDmaExpiration(data.expiration);
  if (!expiresAt) {
    const dur = await query<{ duration_days: number }>(`SELECT duration_days FROM packages WHERE id = $1::uuid`, [
      packageId,
    ]);
    const days = dur.rows[0]?.duration_days ?? 30;
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
  }

  const dataGb = bytesToDataGb(data.comblimit ?? data.downlimit ?? data.uplimit);

  const first = String(data.firstname ?? "").trim();
  const last = String(data.lastname ?? "").trim();
  const displayName = [first, last].filter(Boolean).join(" ") || username;
  const phone = String(data.phone ?? data.mobile ?? "").trim() || null;
  const city = String(data.city ?? "").trim() || null;
  const address = String(data.address ?? "").trim() || null;
  const notesParts = [address, data.comment ? String(data.comment) : ""].filter(Boolean);
  const notes = notesParts.length ? notesParts.join(" — ") : null;

  const { rows: profRows } = await query<{ id: string }>(
    `INSERT INTO customer_profiles (display_name, city, phone, notes)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [displayName, city, phone, notes]
  );
  const profileId = profRows[0]?.id;
  if (!profileId) throw new Error("profile insert failed");

  const passRaw = String(data.password ?? "").trim();
  const mac = String(data.mac ?? "").trim() || null;

  const { rows: subRows } = await query<{ id: string }>(
    `INSERT INTO subscribers (
       username, password_hash, package_id, data_remaining_gb, expires_at, status,
       customer_profile_id, dma_legacy, import_source, connection_type
     ) VALUES (
       $1, NULL, $2::uuid, $3, $4, $5::subscriber_status,
       $6::uuid, $7::jsonb, 'dma', 'pppoe'
     )
     RETURNING id`,
    [username, packageId, dataGb, expiresAt.toISOString(), status, profileId, JSON.stringify(data)]
  );
  const subId = subRows[0]?.id;
  if (!subId) throw new Error("subscriber insert failed");

  if (isMd5Hex(passRaw)) {
    await syncRadcheckMd5Password(username, passRaw.toLowerCase());
  }

  await syncRadiusLocks(username, { mac_lock: mac, ip_lock: null, ip_pool: null });

  await query(
    `UPDATE dma_import_staging SET migrated_subscriber_id = $1::uuid, migrated_at = now(), error_message = NULL WHERE id = $2`,
    [subId, stagingId]
  );
}

export async function migrateDmaStagingBatch(options: {
  defaultPackageId: string;
  groupMap?: Record<string, string>;
  limit?: number;
}): Promise<{ migrated: number; failed: number; errors: { id: number; error: string }[] }> {
  const groupMap = new Map<number, string>();
  if (options.groupMap) {
    for (const [k, v] of Object.entries(options.groupMap)) {
      const id = Number(k);
      if (Number.isFinite(id) && v) groupMap.set(id, v);
    }
  }

  const lim = Math.min(2000, Math.max(1, options.limit ?? 500));
  const { rows: pending } = await query<{ id: number; data: Record<string, unknown> }>(
    `SELECT id, data FROM dma_import_staging WHERE migrated_subscriber_id IS NULL ORDER BY id ASC LIMIT $1`,
    [lim]
  );

  let migrated = 0;
  let failed = 0;
  const errors: { id: number; error: string }[] = [];

  for (const row of pending) {
    try {
      await migrateOneDmaStagingRow(row.id, row.data, options.defaultPackageId, groupMap);
      migrated += 1;
    } catch (e) {
      failed += 1;
      const pg = e as { code?: string; message?: string };
      const msg =
        pg.code === "23505"
          ? "Username already exists"
          : e instanceof Error
            ? e.message
            : String(e);
      errors.push({ id: row.id, error: msg });
      await query(`UPDATE dma_import_staging SET error_message = $2 WHERE id = $1`, [row.id, msg]);
    }
  }

  return { migrated, failed, errors };
}
