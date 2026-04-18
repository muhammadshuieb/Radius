import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { getSchemaFlags, getSchemaFlagsSync } from "../db/schemaFlags.js";
import { query } from "../db/pool.js";
import { DEFAULT_TENANT_ID } from "../constants/tenant.js";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { adminOnly, anyStaff, billingWrite } from "../middleware/rbac.js";
import { parseGoogleLocation } from "../lib/parseGoogleLocation.js";
import {
  expiresAfterPackageDuration,
  extendFromNowOrCurrent,
  normalizeToNoon,
  renewExpiresAt30Days,
} from "../lib/subscriptionNoon.js";
import { radiusAccountingTablesExist } from "../db/ensureRadiusSchema.js";
import { syncRadcheckPassword, syncRadiusLocks } from "../services/radiusSubscriberSync.js";
import { broadcast } from "../ws/broadcast.js";
import { enqueueWhatsAppNewUser, enqueueWhatsAppRenewal } from "../services/whatsappEnqueue.js";
import { insertAuditLog } from "../services/auditLog.js";
import { disconnectAllOpenSessions } from "../services/coa.service.js";
import { buildSubscriberWhereClause, subscriberListFilterSchema } from "../lib/subscriberQueryFilters.js";

const router = Router();
router.use(authMiddleware);
router.use(tenantMiddleware);

const subscriberListSort = z.enum([
  "username",
  "expires_at",
  "data_remaining_gb",
  "created_at",
  "status",
  "payment_status",
  "package_name",
  "profile_display_name",
  "last_accounting_at",
  "created_by_name",
  "account_balance",
]);

const listQuerySchema = subscriberListFilterSchema.extend({
  sort: subscriberListSort.default("username"),
  order: z.enum(["asc", "desc"]).default("asc"),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /api/subscribers — paginated list with filters & sorting
 * Query: search, status, payment_status, speed (e.g. 10M), low_data_gb, expired_only, active_only, sort, order, limit, offset
 */
router.get("/", anyStaff, async (req, res) => {
  const q = listQuerySchema.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: q.error.flatten() });
  const p = q.data;
  const { conditions, params: whereParams } = buildSubscriberWhereClause(
    {
      search: p.search,
      status: p.status,
      payment_status: p.payment_status,
      package_id: p.package_id,
      city: p.city,
      negative_balance: p.negative_balance,
      expires_from: p.expires_from,
      expires_to: p.expires_to,
      speed: p.speed,
      low_data_gb: p.low_data_gb,
      expired_only: p.expired_only,
      active_only: p.active_only,
    },
    req,
    req.tenantId ?? DEFAULT_TENANT_ID
  );
  const params = [...whereParams];
  const limIdx = params.length + 1;
  const offIdx = params.length + 2;
  params.push(p.limit, p.offset);

  const sortColMap: Record<z.infer<typeof subscriberListSort>, string> = {
    username: "s.username",
    expires_at: "s.expires_at",
    data_remaining_gb: "s.data_remaining_gb",
    created_at: "s.created_at",
    status: "s.status",
    payment_status: "s.payment_status",
    package_name: "p.name",
    profile_display_name: "c.display_name",
    last_accounting_at: "s.last_accounting_at",
    created_by_name: "cb.full_name",
    account_balance: `(SELECT COALESCE(SUM(ft.amount), 0)::numeric(14,4) FROM financial_transactions ft WHERE ft.subscriber_id = s.id)`,
  };
  const sortCol = sortColMap[p.sort];
  const order = p.order === "desc" ? "DESC" : "ASC";

  const radiusOk = await radiusAccountingTablesExist();
  const radacctJoin = radiusOk
    ? `LEFT JOIN user_usage_live uul ON uul.tenant_id = s.tenant_id AND lower(btrim(uul.username)) = lower(btrim(s.username))`
    : "";
  const radacctCols = radiusOk
    ? `(uul.input_bytes::numeric / POWER(1024::numeric,3))::numeric(14,4) AS radacct_in_gb,
        (uul.output_bytes::numeric / POWER(1024::numeric,3))::numeric(14,4) AS radacct_out_gb`
    : `NULL::numeric AS radacct_in_gb, NULL::numeric AS radacct_out_gb`;

  const liveSelect = radiusOk
    ? `, live.framedipaddress::text AS subscriber_current_ip,
         (live.framedipaddress IS NOT NULL) AS subscriber_is_online,
         live.nas_display AS subscriber_nas_name,
         lo.last_logout::text AS subscriber_last_logout,
         live.session_start AS subscriber_session_start`
    : `, NULL::text AS subscriber_current_ip,
         false AS subscriber_is_online,
         NULL::text AS subscriber_nas_name,
         NULL::text AS subscriber_last_logout,
         NULL::text AS subscriber_session_start`;
  const liveJoin = radiusOk
    ? `
    LEFT JOIN LATERAL (
      SELECT r.framedipaddress, ms.name AS nas_display, r.acctstarttime::text AS session_start
      FROM radacct r
      LEFT JOIN mikrotik_servers ms ON trim(both from ms.host) = host(r.nasipaddress)::text
      WHERE lower(btrim(r.username)) = lower(btrim(s.username)) AND r.acctstoptime IS NULL
      ORDER BY r.acctstarttime DESC NULLS LAST
      LIMIT 1
    ) live ON true
    LEFT JOIN LATERAL (
      SELECT max(r.acctstoptime) AS last_logout
      FROM radacct r
      WHERE lower(btrim(r.username)) = lower(btrim(s.username)) AND r.acctstoptime IS NOT NULL
    ) lo ON true`
    : "";

  const sql = `
    SELECT s.*,
           p.name AS package_name,
           p.speed_up AS pkg_speed_up,
           p.speed_down AS pkg_speed_down,
           p.data_limit_gb AS pkg_data_limit_gb,
           p.price AS pkg_price,
           p.duration_days AS pkg_duration_days,
           c.display_name AS profile_display_name,
           c.phone AS profile_phone,
           cb.full_name AS created_by_name,
           (SELECT COALESCE(SUM(ft.amount), 0)::numeric(14,4)
              FROM financial_transactions ft WHERE ft.subscriber_id = s.id) AS account_balance,
           ${radacctCols}
           ${liveSelect}
    FROM subscribers s
    LEFT JOIN packages p ON p.id = s.package_id
    LEFT JOIN customer_profiles c ON c.id = s.customer_profile_id
    LEFT JOIN staff_users cb ON cb.id = s.created_by
    ${radacctJoin}
    ${liveJoin}
    WHERE ${conditions.join(" AND ")}
    ORDER BY ${sortCol} ${order} NULLS LAST
    LIMIT $${limIdx} OFFSET $${offIdx}
  `;
  const countSql = `
    SELECT count(*)::int AS c FROM subscribers s
    LEFT JOIN packages p ON p.id = s.package_id
    LEFT JOIN customer_profiles c ON c.id = s.customer_profile_id
    WHERE ${conditions.join(" AND ")}
  `;
  const [{ rows }, { rows: countRows }] = await Promise.all([query(sql, params), query(countSql, params.slice(0, -2))]);
  res.json({ items: rows, total: countRows[0]?.c ?? 0, limit: p.limit, offset: p.offset });
});

/**
 * GET /api/subscribers/:id — subscriber + package + customer profile (customer page)
 */
router.get("/:id", anyStaff, async (req, res) => {
  const f = await getSchemaFlags();
  const nickSql = f.customer_nickname ? "c.nickname" : "NULL::text AS nickname";
  const citySql = f.customer_city ? "c.city AS profile_city" : "NULL::text AS profile_city";
  const radiusOk = await radiusAccountingTablesExist();
  const liveSelect = radiusOk
    ? `, live.framedipaddress::text AS subscriber_current_ip,
         (live.framedipaddress IS NOT NULL) AS subscriber_is_online,
         live.nas_display AS subscriber_nas_name,
         lo.last_logout::text AS subscriber_last_logout,
         live.session_start AS subscriber_session_start`
    : `, NULL::text AS subscriber_current_ip,
         false AS subscriber_is_online,
         NULL::text AS subscriber_nas_name,
         NULL::text AS subscriber_last_logout,
         NULL::text AS subscriber_session_start`;
  const liveJoin = radiusOk
    ? `
    LEFT JOIN LATERAL (
      SELECT r.framedipaddress, ms.name AS nas_display, r.acctstarttime::text AS session_start
      FROM radacct r
      LEFT JOIN mikrotik_servers ms ON trim(both from ms.host) = host(r.nasipaddress)::text
      WHERE lower(btrim(r.username)) = lower(btrim(s.username)) AND r.acctstoptime IS NULL
      ORDER BY r.acctstarttime DESC NULLS LAST
      LIMIT 1
    ) live ON true
    LEFT JOIN LATERAL (
      SELECT max(r.acctstoptime) AS last_logout
      FROM radacct r
      WHERE lower(btrim(r.username)) = lower(btrim(s.username)) AND r.acctstoptime IS NOT NULL
    ) lo ON true`
    : "";
  const { rows } = await query(
    `SELECT s.*,
            p.name AS package_name, p.speed_up AS pkg_speed_up, p.speed_down AS pkg_speed_down,
            p.data_limit_gb AS pkg_data_limit_gb, p.price AS pkg_price, p.duration_days AS pkg_duration_days,
            c.display_name, ${nickSql}, ${citySql}, c.phone, c.notes, c.location_lat, c.location_lng, c.linked_devices,
            cb.full_name AS created_by_name,
            (SELECT COALESCE(SUM(ft.amount), 0)::numeric(14,4) FROM financial_transactions ft WHERE ft.subscriber_id = s.id) AS account_balance
            ${liveSelect}
     FROM subscribers s
     LEFT JOIN packages p ON p.id = s.package_id
     LEFT JOIN customer_profiles c ON c.id = s.customer_profile_id
     LEFT JOIN staff_users cb ON cb.id = s.created_by
     ${liveJoin}
     WHERE s.id = $1 AND s.tenant_id = $2`,
    [req.params.id, req.tenantId ?? DEFAULT_TENANT_ID]
  );
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  const row = rows[0] as Record<string, unknown>;
  if (req.user?.role === "manager" && req.user.scope_city?.trim() && getSchemaFlagsSync().customer_city) {
    const pc = String(row.profile_city ?? "")
      .trim()
      .toLowerCase();
    if (!pc || pc !== req.user.scope_city.trim().toLowerCase()) {
      return res.status(404).json({ error: "Not found" });
    }
  }
  res.json(row);
});

const USERNAME_RE = /^[\p{L}\p{N}._@+-]{2,64}$/u;

/** Allow explicit `null` from JSON (frontend sends null for cleared fields); optional alone rejects null in Zod. */
const customerProfileFields = z.object({
  display_name: z.string().nullish(),
  nickname: z.string().nullish(),
  city: z.string().nullish(),
  phone: z.string().nullish(),
  notes: z.string().nullish(),
  location_lat: z.number().nullish(),
  location_lng: z.number().nullish(),
  linked_devices: z.array(z.unknown()).nullish(),
});

type CustomerProfileIn = z.infer<typeof customerProfileFields>;

function customerProfileHasPayload(cp: CustomerProfileIn): boolean {
  if (cp.display_name?.trim()) return true;
  if (cp.nickname?.trim()) return true;
  if (cp.city?.trim()) return true;
  if (cp.phone?.trim()) return true;
  if (cp.notes?.trim()) return true;
  if (cp.location_lat != null && cp.location_lng != null) return true;
  if (Array.isArray(cp.linked_devices) && cp.linked_devices.length > 0) return true;
  return false;
}

const createSchema = z.object({
  username: z
    .string()
    .max(128)
    .transform((s) => s.trim())
    .refine((s) => s.length >= 2, { message: "Username must be at least 2 characters" })
    .refine((s) => USERNAME_RE.test(s), {
      message:
        "Username: 2–64 characters; letters (any script), digits, and . _ @ + - only; no spaces.",
    }),
  password: z.string().min(1).optional(),
  package_id: z.string().uuid().optional(),
  speed_up_override: z.string().optional(),
  speed_down_override: z.string().optional(),
  /** When true, subscriber has unlimited quota regardless of package cap. */
  unlimited_data: z.boolean().optional(),
  data_remaining_gb: z.number().nullable().optional(),
  expires_at: z.string().optional().nullable(),
  payment_status: z.enum(["paid", "unpaid", "partial"]).optional(),
  /** Initial account state (e.g. provision disabled until payment). */
  status: z.enum(["active", "disabled"]).optional().default("active"),
  /** RADIUS / MikroTik service type hint for ops & future sync. */
  connection_type: z.enum(["pppoe", "hotspot"]).optional().default("pppoe"),
  /** Aliases merged into `customer_profile` (no extra DB columns). */
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  /** "lat,lng" or a Google Maps link; merged into location_lat/lng when those are absent. */
  google_location: z.string().optional(),
  customer_profile: customerProfileFields.optional(),
  mac_lock: z.string().max(64).optional().nullable(),
  ip_lock: z.string().max(64).optional().nullable(),
  ip_pool: z.string().max(128).optional().nullable(),
});

type CreateBody = z.infer<typeof createSchema>;

function mergeCreateCustomerProfile(b: CreateBody): CustomerProfileIn | undefined {
  const base: CustomerProfileIn = { ...(b.customer_profile ?? {}) };
  const parts = [b.first_name?.trim(), b.last_name?.trim()].filter((x) => !!x) as string[];
  const joined = parts.join(" ");
  if (joined && !base.display_name?.trim()) {
    base.display_name = joined;
  }
  if (base.location_lat == null && base.location_lng == null && b.google_location?.trim()) {
    const pos = parseGoogleLocation(b.google_location);
    if (pos) {
      base.location_lat = pos.lat;
      base.location_lng = pos.lng;
    }
  }
  if (!customerProfileHasPayload(base)) return undefined;
  return base;
}

/**
 * POST /api/subscribers — create; default package if package_id omitted
 */
router.post("/", billingWrite, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  let packageId = b.package_id;
  if (!packageId) {
    const { rows: def } = await query<{ id: string }>(
      `SELECT id FROM packages WHERE is_default = true AND tenant_id = $1 LIMIT 1`,
      [tid]
    );
    packageId = def[0]?.id;
  }
  if (!packageId) {
    return res.status(400).json({ error: "package_id is required, or create a default package first" });
  }

  const { rows: pkgRows } = await query<{ data_limit_gb: string | null; duration_days: number | null }>(
    `SELECT data_limit_gb, duration_days FROM packages WHERE id = $1 AND tenant_id = $2`,
    [packageId, tid]
  );
  if (!pkgRows[0]) {
    return res.status(400).json({ error: "Unknown package_id — use an existing package UUID" });
  }

  let profileId: string | null = null;
  const mergedProfile = mergeCreateCustomerProfile(b);
  if (mergedProfile) {
    const cp = mergedProfile;
    const f = await getSchemaFlags();
    const ext = f.customer_nickname && f.customer_city;
    const { rows } = ext
      ? await query<{ id: string }>(
          `INSERT INTO customer_profiles (display_name, nickname, city, phone, notes, location_lat, location_lng, linked_devices)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id`,
          [
            cp.display_name ?? null,
            cp.nickname ?? null,
            cp.city ?? null,
            cp.phone ?? null,
            cp.notes ?? null,
            cp.location_lat ?? null,
            cp.location_lng ?? null,
            JSON.stringify(cp.linked_devices ?? []),
          ]
        )
      : await query<{ id: string }>(
          `INSERT INTO customer_profiles (display_name, phone, notes, location_lat, location_lng, linked_devices)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id`,
          [
            cp.display_name ?? null,
            cp.phone ?? null,
            cp.notes ?? null,
            cp.location_lat ?? null,
            cp.location_lng ?? null,
            JSON.stringify(cp.linked_devices ?? []),
          ]
        );
    profileId = rows[0].id;
  }
  const rawLimit = pkgRows[0]?.data_limit_gb != null ? Number(pkgRows[0].data_limit_gb) : null;
  const dataLimit = rawLimit != null && Number.isFinite(rawLimit) ? rawLimit : null;
  let dataRemaining: number | null;
  if (b.unlimited_data) {
    dataRemaining = null;
  } else if (b.data_remaining_gb !== undefined && Number.isFinite(b.data_remaining_gb)) {
    dataRemaining = b.data_remaining_gb;
  } else {
    dataRemaining = dataLimit;
  }

  let passwordHash: string | null = null;
  if (b.password) {
    passwordHash = await bcrypt.hash(b.password, 10);
  }

  const initialStatus = b.status === "disabled" ? "disabled" : "active";
  const connType = b.connection_type === "hotspot" ? "hotspot" : "pppoe";

  let expiresAt: Date | null;
  if (b.expires_at != null && String(b.expires_at).trim() !== "") {
    expiresAt = normalizeToNoon(new Date(b.expires_at as string));
  } else {
    const dur = pkgRows[0]?.duration_days ?? 30;
    expiresAt = expiresAfterPackageDuration(dur);
  }

  const createdBy = req.user?.id ?? null;
  const macLock = b.mac_lock?.trim() || null;
  const ipLock = b.ip_lock?.trim() || null;
  const ipPool = b.ip_pool?.trim() || null;

  try {
    const { rows } = await query<{ id: string; username: string }>(
      `INSERT INTO subscribers (
         username, password_hash, package_id, speed_up_override, speed_down_override,
         data_remaining_gb, expires_at, status, payment_status, customer_profile_id, connection_type,
         mac_lock, ip_lock, ip_pool, created_by, tenant_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::subscriber_status, coalesce($9::payment_status, 'unpaid'::payment_status), $10, $11, $12, $13, $14, $15, $16)
       RETURNING id, username`,
      [
        b.username,
        passwordHash,
        packageId,
        b.speed_up_override ?? null,
        b.speed_down_override ?? null,
        dataRemaining,
        expiresAt,
        initialStatus,
        b.payment_status ?? "unpaid",
        profileId,
        connType,
        macLock,
        ipLock,
        ipPool,
        createdBy,
        tid,
      ]
    );
    const uname = rows[0].username ?? b.username;
    if (b.password) {
      await syncRadcheckPassword(uname, b.password);
    }
    await syncRadiusLocks(uname, { mac_lock: macLock, ip_lock: ipLock, ip_pool: ipPool });
    broadcast("subscribers.updated", { id: rows[0].id });
    void enqueueWhatsAppNewUser(rows[0].id).catch((err) => console.warn("[whatsapp] new user", err));
    void insertAuditLog(req, {
      action: "subscriber.create",
      entityType: "subscriber",
      entityId: rows[0].id,
      details: { username: rows[0].username },
    });
    res.status(201).json(rows[0]);
  } catch (e: unknown) {
    console.error("[POST /api/subscribers]", e);
    const pg = e as { code?: string };
    if (pg.code === "23505") {
      return res.status(409).json({ error: "Username already exists" });
    }
    const dev = process.env.NODE_ENV !== "production";
    const msg = dev && e instanceof Error ? e.message : "Internal server error";
    return res.status(500).json({ error: msg });
  }
});

const patchSchema = createSchema
  .partial()
  .omit({ username: true, password: true, first_name: true, last_name: true, google_location: true })
  .extend({
    password: z.string().min(1).optional(),
    status: z.enum(["active", "expired", "disabled"]).optional(),
  });
/**
 * PATCH /api/subscribers/:id — update fields, payment status, location via nested customer_profile
 */
router.patch("/:id", billingWrite, async (req, res) => {
  const id = req.params.id;
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;

  if (b.password) {
    const passwordHash = await bcrypt.hash(b.password, 10);
    await query(`UPDATE subscribers SET password_hash = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3`, [
      passwordHash,
      id,
      tid,
    ]);
  }

  if (b.unlimited_data === true) {
    await query(`UPDATE subscribers SET data_remaining_gb = null, updated_at = now() WHERE id = $1 AND tenant_id = $2`, [
      id,
      tid,
    ]);
  }
  const { rows: sub } = await query<{ customer_profile_id: string | null }>(
    `SELECT customer_profile_id FROM subscribers WHERE id = $1 AND tenant_id = $2`,
    [id, tid]
  );
  if (!sub[0]) return res.status(404).json({ error: "Not found" });

  if (b.customer_profile) {
    const cp = b.customer_profile;
    const f = await getSchemaFlags();
    const ext = f.customer_nickname && f.customer_city;
    if (sub[0].customer_profile_id) {
      if (ext) {
        await query(
          `UPDATE customer_profiles SET
             display_name = coalesce($1, display_name),
             nickname = coalesce($2, nickname),
             city = coalesce($3, city),
             phone = coalesce($4, phone),
             notes = coalesce($5, notes),
             location_lat = coalesce($6, location_lat),
             location_lng = coalesce($7, location_lng),
             linked_devices = coalesce($8::jsonb, linked_devices),
             updated_at = now()
           WHERE id = $9`,
          [
            cp.display_name ?? null,
            cp.nickname ?? null,
            cp.city ?? null,
            cp.phone ?? null,
            cp.notes ?? null,
            cp.location_lat ?? null,
            cp.location_lng ?? null,
            cp.linked_devices ? JSON.stringify(cp.linked_devices) : null,
            sub[0].customer_profile_id,
          ]
        );
      } else {
        await query(
          `UPDATE customer_profiles SET
             display_name = coalesce($1, display_name),
             phone = coalesce($2, phone),
             notes = coalesce($3, notes),
             location_lat = coalesce($4, location_lat),
             location_lng = coalesce($5, location_lng),
             linked_devices = coalesce($6::jsonb, linked_devices),
             updated_at = now()
           WHERE id = $7`,
          [
            cp.display_name ?? null,
            cp.phone ?? null,
            cp.notes ?? null,
            cp.location_lat ?? null,
            cp.location_lng ?? null,
            cp.linked_devices ? JSON.stringify(cp.linked_devices) : null,
            sub[0].customer_profile_id,
          ]
        );
      }
    } else {
      const { rows } = ext
        ? await query<{ id: string }>(
            `INSERT INTO customer_profiles (display_name, nickname, city, phone, notes, location_lat, location_lng, linked_devices)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id`,
            [
              cp.display_name ?? null,
              cp.nickname ?? null,
              cp.city ?? null,
              cp.phone ?? null,
              cp.notes ?? null,
              cp.location_lat ?? null,
              cp.location_lng ?? null,
              JSON.stringify(cp.linked_devices ?? []),
            ]
          )
        : await query<{ id: string }>(
            `INSERT INTO customer_profiles (display_name, phone, notes, location_lat, location_lng, linked_devices)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id`,
            [
              cp.display_name ?? null,
              cp.phone ?? null,
              cp.notes ?? null,
              cp.location_lat ?? null,
              cp.location_lng ?? null,
              JSON.stringify(cp.linked_devices ?? []),
            ]
          );
      await query(`UPDATE subscribers SET customer_profile_id = $1 WHERE id = $2 AND tenant_id = $3`, [
        rows[0].id,
        id,
        tid,
      ]);
    }
  }

  const fields: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;
  for (const k of [
    "package_id",
    "speed_up_override",
    "speed_down_override",
    "data_remaining_gb",
    "data_used_gb",
    "expires_at",
    "status",
    "payment_status",
    "connection_type",
    "mac_lock",
    "ip_lock",
    "ip_pool",
  ] as const) {
    if (k in b && (b as Record<string, unknown>)[k] !== undefined) {
      let val: unknown = (b as Record<string, unknown>)[k];
      if (k === "expires_at") {
        if (val === null || val === "") {
          val = null;
        } else {
          val = normalizeToNoon(new Date(String(val)));
        }
      }
      if (k === "mac_lock" || k === "ip_lock" || k === "ip_pool") {
        const s = val === null || val === "" ? null : String(val).trim();
        val = s;
      }
      fields.push(`${k} = $${idx++}`);
      vals.push(val);
    }
  }
  if (fields.length) {
    vals.push(id, tid);
    await query(
      `UPDATE subscribers SET ${fields.join(", ")}, updated_at = now() WHERE id = $${idx} AND tenant_id = $${idx + 1}`,
      vals
    );
  }
  if (b.password || b.mac_lock !== undefined || b.ip_lock !== undefined || b.ip_pool !== undefined) {
    const { rows: urow } = await query<{
      username: string;
      mac_lock: string | null;
      ip_lock: string | null;
      ip_pool: string | null;
    }>(`SELECT username, mac_lock, ip_lock, ip_pool FROM subscribers WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (urow[0]) {
      if (b.password) await syncRadcheckPassword(urow[0].username, b.password);
      if (b.mac_lock !== undefined || b.ip_lock !== undefined || b.ip_pool !== undefined) {
        await syncRadiusLocks(urow[0].username, {
          mac_lock: urow[0].mac_lock,
          ip_lock: urow[0].ip_lock,
          ip_pool: urow[0].ip_pool,
        });
      }
    }
  }
  broadcast("subscribers.updated", { id });
  void insertAuditLog(req, {
    action: "subscriber.update",
    entityType: "subscriber",
    entityId: id,
    details: { fields: Object.keys(b) },
  });
  res.json({ ok: true });
});

const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  action: z.enum(["disable", "extend", "reset_data"]),
  extend_days: z.number().int().positive().optional(),
});

/**
 * POST /api/subscribers/bulk — disable | extend | reset_data
 */
router.post("/bulk", adminOnly, async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { ids, action, extend_days } = parsed.data;
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  if (action === "disable") {
    await query(
      `UPDATE subscribers SET status = 'disabled', updated_at = now() WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
      [ids, tid]
    );
  } else if (action === "extend") {
    const days = extend_days ?? 30;
    for (const sid of ids) {
      const { rows } = await query<{ expires_at: string | null; status: string }>(
        `SELECT expires_at, status::text AS status FROM subscribers WHERE id = $1 AND tenant_id = $2`,
        [sid, tid]
      );
      const row = rows[0];
      if (!row) continue;
      const { expiresAt } = extendFromNowOrCurrent(
        row.expires_at ? new Date(row.expires_at) : null,
        row.status,
        days
      );
      await query(
        `UPDATE subscribers SET
           expires_at = $1,
           status = CASE WHEN status = 'expired'::subscriber_status THEN 'active'::subscriber_status ELSE status END,
           updated_at = now()
         WHERE id = $2 AND tenant_id = $3`,
        [expiresAt, sid, tid]
      );
    }
  } else if (action === "reset_data") {
    await query(
      `UPDATE subscribers s SET
         data_remaining_gb = p.data_limit_gb,
         data_used_gb = 0,
         updated_at = now()
       FROM packages p
       WHERE s.package_id = p.id AND s.id = ANY($1::uuid[]) AND s.tenant_id = $2`,
      [ids, tid]
    );
  }
  broadcast("subscribers.updated", { bulk: true });
  void insertAuditLog(req, {
    action: `subscriber.bulk.${action}`,
    entityType: "subscriber",
    details: { count: ids.length, action },
  });
  res.json({ ok: true });
});

/**
 * PATCH /api/subscribers/:id/payment — toggle paid/unpaid (accountant+admin)
 */
router.patch("/:id/payment", billingWrite, async (req, res) => {
  const schema = z.object({ payment_status: z.enum(["paid", "unpaid", "partial"]) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  await query(
    `UPDATE subscribers SET payment_status = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3`,
    [parsed.data.payment_status, req.params.id, tid]
  );
  broadcast("subscribers.updated", { id: req.params.id });
  res.json({ ok: true });
});

/**
 * POST /api/subscribers/:id/reactivate — renew from now using package duration (default 30d if no package)
 */
router.post("/:id/reactivate", billingWrite, async (req, res) => {
  const id = req.params.id;
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await query<{ duration_days: number | null; expires_at: string | null; status: string }>(
    `SELECT p.duration_days, s.expires_at, s.status::text AS status
     FROM subscribers s LEFT JOIN packages p ON p.id = s.package_id WHERE s.id = $1 AND s.tenant_id = $2`,
    [id, tid]
  );
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  const days = rows[0].duration_days ?? 30;
  const { expiresAt } = extendFromNowOrCurrent(
    rows[0].expires_at ? new Date(rows[0].expires_at) : null,
    rows[0].status,
    days
  );
  await query(
    `UPDATE subscribers SET
       status = 'active',
       expires_at = $1,
       updated_at = now()
     WHERE id = $2 AND tenant_id = $3`,
    [expiresAt, id, tid]
  );
  broadcast("subscribers.updated", { id });
  void enqueueWhatsAppRenewal(id).catch((err) => console.warn("[whatsapp] reactivate", err));
  res.json({ ok: true, expires_added_days: days });
});

/**
 * POST /api/subscribers/:id/adjust-data — add (or subtract) quota GB
 */
router.post("/:id/adjust-data", billingWrite, async (req, res) => {
  const schema = z.object({ delta_gb: z.number() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const id = req.params.id;
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  const { rowCount } = await query(
    `UPDATE subscribers SET
       data_remaining_gb = COALESCE(data_remaining_gb, 0) + $1,
       updated_at = now()
     WHERE id = $2 AND tenant_id = $3`,
    [parsed.data.delta_gb, id, tid]
  );
  if (!rowCount) return res.status(404).json({ error: "Not found" });
  broadcast("subscribers.updated", { id });
  res.json({ ok: true });
});

/**
 * POST /api/subscribers/:id/extend — extend expiry by N days (reactivates if expired)
 */
router.post("/:id/extend", billingWrite, async (req, res) => {
  const schema = z.object({ days: z.number().int().positive().max(3650) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const id = req.params.id;
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  const days = parsed.data.days;
  const { rows } = await query<{ expires_at: string | null; status: string }>(
    `SELECT expires_at, status::text AS status FROM subscribers WHERE id = $1 AND tenant_id = $2`,
    [id, tid]
  );
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  const { expiresAt } = extendFromNowOrCurrent(
    rows[0].expires_at ? new Date(rows[0].expires_at) : null,
    rows[0].status,
    days
  );
  await query(
    `UPDATE subscribers SET
       expires_at = $1,
       status = CASE WHEN status = 'expired'::subscriber_status THEN 'active'::subscriber_status ELSE status END,
       updated_at = now()
     WHERE id = $2 AND tenant_id = $3`,
    [expiresAt, id, tid]
  );
  broadcast("subscribers.updated", { id });
  void enqueueWhatsAppRenewal(id).catch((err) => console.warn("[whatsapp] extend", err));
  res.json({ ok: true });
});

const renewSchema = z.object({
  radius_password: z.string().min(1).optional(),
  invoice_id: z.string().uuid().optional(),
});

/**
 * POST /api/subscribers/:id/renew — mark outstanding invoice paid, +30d at noon, RADIUS re-enable (password optional)
 */
router.post("/:id/renew", billingWrite, async (req, res) => {
  const parsed = renewSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { radius_password, invoice_id: bodyInvoiceId } = parsed.data;
  const id = req.params.id;
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;

  const { rows: subs } = await query<{
    username: string;
    expires_at: string | null;
    status: string;
    mac_lock: string | null;
    ip_lock: string | null;
    ip_pool: string | null;
  }>(
    `SELECT s.username, s.expires_at, s.status::text AS status, s.mac_lock, s.ip_lock, s.ip_pool
     FROM subscribers s WHERE s.id = $1 AND s.tenant_id = $2`,
    [id, tid]
  );
  if (!subs[0]) return res.status(404).json({ error: "Not found" });
  const sub = subs[0];

  const { rows: pkg } = await query<{ price: string | null; currency: string | null }>(
    `SELECT p.price::text, p.currency FROM subscribers s LEFT JOIN packages p ON p.id = s.package_id WHERE s.id = $1 AND s.tenant_id = $2`,
    [id, tid]
  );
  const pkgPrice = pkg[0]?.price != null ? Number(pkg[0].price) : 0;
  const pkgCur = (pkg[0]?.currency ?? "USD").slice(0, 3);

  let invId: string | null = null;
  let invAmount = pkgPrice;
  let invCur = pkgCur;

  if (bodyInvoiceId) {
    const { rows: invRows } = await query<{
      id: string;
      amount: string;
      currency: string;
      subscriber_id: string | null;
      status: string;
    }>(
      `SELECT id, amount::text, currency, subscriber_id, status::text AS status FROM invoices WHERE id = $1`,
      [bodyInvoiceId]
    );
    const ir = invRows[0];
    if (!ir || ir.subscriber_id !== id) return res.status(400).json({ error: "Invalid invoice for this subscriber" });
    if (ir.status === "paid") return res.status(400).json({ error: "Invoice already paid" });
    invId = ir.id;
    invAmount = Number(ir.amount);
    invCur = ir.currency.slice(0, 3);
  } else {
    const { rows: openInv } = await query<{ id: string; amount: string; currency: string }>(
      `SELECT id, amount::text, currency FROM invoices
       WHERE subscriber_id = $1 AND status <> 'paid'::payment_status
       ORDER BY issued_at DESC LIMIT 1`,
      [id]
    );
    if (openInv[0]) {
      invId = openInv[0].id;
      invAmount = Number(openInv[0].amount);
      invCur = openInv[0].currency.slice(0, 3);
    } else {
      const { rows: cre } = await query<{ id: string }>(
        `INSERT INTO invoices (subscriber_id, period, title, amount, tax_amount, currency, status, tenant_id)
         VALUES ($1, 'one_time', 'Subscription renewal', $2, 0, $3, 'unpaid', $4)
         RETURNING id`,
        [id, invAmount, invCur, tid]
      );
      invId = cre[0].id;
    }
  }

  if (!invId) return res.status(500).json({ error: "Could not resolve invoice" });

  const before = sub.expires_at ? new Date(sub.expires_at) : null;
  const { expiresAt } = renewExpiresAt30Days(before, sub.status);
  const expiresBefore = sub.expires_at;

  let sessionNote = "";
  if (await radiusAccountingTablesExist()) {
    const { rows: onl } = await query(
      `SELECT 1 FROM radacct WHERE lower(btrim(username)) = lower(btrim($1)) AND acctstoptime IS NULL LIMIT 1`,
      [sub.username]
    );
    if (onl.length) sessionNote = "User had an open session at renewal.";
  }

  await query(`UPDATE invoices SET status = 'paid'::payment_status, paid_at = now() WHERE id = $1`, [invId]);
  await query(
    `INSERT INTO payments (invoice_id, subscriber_id, amount, method, reference, tenant_id)
     VALUES ($1, $2, $3, 'renewal', $4, $5)`,
    [invId, id, invAmount, `renew:${invId}`, tid]
  );

  await query(
    `UPDATE subscribers SET
       expires_at = $1,
       status = 'active'::subscriber_status,
       payment_status = 'paid'::payment_status,
       updated_at = now()
     WHERE id = $2 AND tenant_id = $3`,
    [expiresAt, id, tid]
  );

  const notes = [
    sessionNote,
    radius_password ? "Cleartext RADIUS password applied in radcheck." : "",
  ]
    .filter(Boolean)
    .join(" ");

  await query(
    `INSERT INTO subscriber_renewal_logs (
       subscriber_id, staff_user_id, invoice_id, amount, currency, expires_before, expires_after, notes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, req.user?.id ?? null, invId, invAmount, invCur, expiresBefore, expiresAt, notes || null]
  );

  if (radius_password) {
    await syncRadcheckPassword(sub.username, radius_password);
  }
  await syncRadiusLocks(sub.username, {
    mac_lock: sub.mac_lock,
    ip_lock: sub.ip_lock,
    ip_pool: sub.ip_pool,
  });

  broadcast("invoices.updated", { id: invId });
  broadcast("subscribers.updated", { id });
  void enqueueWhatsAppRenewal(id).catch((err) => console.warn("[whatsapp] renewal", err));
  res.json({ ok: true, invoice_id: invId, expires_at: expiresAt.toISOString() });
});

/**
 * POST /api/subscribers/:id/disconnect — close open radacct rows for this username (best-effort)
 */
router.post("/:id/disconnect", billingWrite, async (req, res) => {
  const id = req.params.id;
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await query<{ username: string }>(
    `SELECT username FROM subscribers WHERE id = $1 AND tenant_id = $2`,
    [id, tid]
  );
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  if (!(await radiusAccountingTablesExist())) {
    return res.status(503).json({ error: "RADIUS accounting tables not available" });
  }
  let coa: Awaited<ReturnType<typeof disconnectAllOpenSessions>> = [];
  try {
    coa = await disconnectAllOpenSessions(rows[0].username);
  } catch (e) {
    console.warn("[disconnect] CoA:", e);
  }
  const { rowCount } = await query(
    `UPDATE radacct SET acctstoptime = now(), acctterminatecause = 'Admin-Disconnect'
     WHERE acctstoptime IS NULL AND lower(btrim(username)) = lower(btrim($1))`,
    [rows[0].username]
  );
  res.json({ ok: true, closed_sessions: rowCount ?? 0, coa_attempts: coa });
});

/**
 * DELETE /api/subscribers/:id — admin only
 */
router.delete("/:id", adminOnly, async (req, res) => {
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  await query(`DELETE FROM subscribers WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
  broadcast("subscribers.updated", { id: req.params.id, deleted: true });
  void insertAuditLog(req, {
    action: "subscriber.delete",
    entityType: "subscriber",
    entityId: req.params.id,
  });
  res.json({ ok: true });
});

export default router;
