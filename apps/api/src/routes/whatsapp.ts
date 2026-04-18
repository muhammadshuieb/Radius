import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { DEFAULT_TENANT_ID } from "../constants/tenant.js";
import { query } from "../db/pool.js";
import {
  buildSubscriberWhereClause,
  subscriberListFilterSchema,
  type SubscriberListFilters,
} from "../lib/subscriberQueryFilters.js";
import { normalizePhoneToChatId } from "../lib/whatsappPhone.js";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { adminOnly } from "../middleware/rbac.js";
import { runWhatsAppBulkSend } from "../services/whatsappBulkSendRunner.js";
import { insertAuditLog } from "../services/auditLog.js";
import { getWhatsAppSettings, saveWhatsAppSettings } from "../services/whatsappSettingsDb.js";
import { isWahaConfigured, wahaFetch, wahaJson } from "../services/waha.js";
import { ensureWahaSessionReady, wahaSessionPath } from "../services/wahaSessionEnsure.js";
import { purgeWhatsAppDeliveryLogOlderThanRetention } from "../services/whatsappDeliveryLogCleanup.js";

function filtersAreMeaningful(f: SubscriberListFilters): boolean {
  return !!(
    f.search?.trim() ||
    f.city?.trim() ||
    f.package_id ||
    f.status ||
    f.payment_status ||
    f.expired_only ||
    f.active_only ||
    f.expires_from ||
    f.expires_to ||
    f.speed ||
    f.low_data_gb != null ||
    f.negative_balance
  );
}

async function fetchSubscriberIdsByFilters(req: Request, filters: SubscriberListFilters, max: number): Promise<string[]> {
  const { conditions, params: whereParams } = buildSubscriberWhereClause(
    filters,
    req,
    req.tenantId ?? DEFAULT_TENANT_ID
  );
  const params = [...whereParams];
  const limIdx = params.length + 1;
  params.push(max);
  const sql = `
    SELECT s.id::text AS id FROM subscribers s
    LEFT JOIN packages p ON p.id = s.package_id
    LEFT JOIN customer_profiles c ON c.id = s.customer_profile_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY s.username ASC
    LIMIT $${limIdx}
  `;
  const { rows } = await query<{ id: string }>(sql, params);
  return rows.map((r) => r.id);
}

const router = Router();
router.use(authMiddleware);
router.use(tenantMiddleware);

const settingsPutSchema = z.object({
  company_name: z.string().min(1).max(200).optional(),
  template_renewal: z.string().max(8000).optional(),
  template_new_user: z.string().max(8000).optional(),
  template_expiry: z.string().max(8000).optional(),
  template_credit: z.string().max(8000).optional(),
  template_debt: z.string().max(8000).optional(),
  expiry_days_before: z.coerce.number().int().min(1).max(90).optional(),
  send_hour: z.coerce.number().int().min(0).max(23).optional(),
  send_minute: z.coerce.number().int().min(0).max(59).optional(),
  timezone: z.string().min(1).max(80).optional(),
  delay_between_ms: z.coerce.number().int().min(500).max(120_000).optional(),
  notify_renewal: z.boolean().optional(),
  notify_new_user: z.boolean().optional(),
  notify_expiry: z.boolean().optional(),
});

/**
 * GET /api/whatsapp/settings — templates & scheduling (admin)
 */
router.get("/settings", adminOnly, async (_req, res) => {
  const s = await getWhatsAppSettings();
  res.json({
    ...s,
    placeholders: [
      "{company}",
      "{username}",
      "{full_name}",
      "{expires_at}",
      "{days_left}",
      "{balance}",
      "{phone}",
    ],
  });
});

/**
 * PUT /api/whatsapp/settings (admin)
 */
router.put("/settings", adminOnly, async (req, res) => {
  const parsed = settingsPutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const s = await saveWhatsAppSettings(parsed.data);
  void insertAuditLog(req, {
    action: "whatsapp.settings.update",
    entityType: "whatsapp_settings",
    details: { keys: Object.keys(parsed.data) },
  });
  res.json(s);
});

const broadcastSchema = z
  .object({
    message: z.string().min(1).max(4000),
    subscriber_ids: z.array(z.string().uuid()).max(500).optional(),
    filters: subscriberListFilterSchema.optional(),
  })
  .refine((d) => (d.subscriber_ids?.length ?? 0) > 0 || d.filters != null, {
    message: "Provide subscriber_ids and/or filters",
  });

/**
 * GET /api/whatsapp/broadcast-targets — resolve up to 500 subscriber UUIDs from list filters (admin)
 */
router.get("/broadcast-targets", adminOnly, async (req, res) => {
  const parsed = subscriberListFilterSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!filtersAreMeaningful(parsed.data)) {
    return res.status(400).json({
      error: "Specify at least one filter (package, city, status, search, …) to load recipients",
    });
  }
  const ids = await fetchSubscriberIdsByFilters(req, parsed.data, 500);
  res.json({ ids, count: ids.length });
});

/**
 * POST /api/whatsapp/broadcast — maintenance / outage message to many subscribers (admin)
 */
router.post("/broadcast", adminOnly, async (req, res) => {
  if (!isWahaConfigured()) return res.status(400).json({ error: "WAHA not configured" });
  const parsed = broadcastSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { message } = parsed.data;

  let subscriber_ids: string[] = [];
  if (parsed.data.subscriber_ids?.length) {
    subscriber_ids = parsed.data.subscriber_ids;
  } else if (parsed.data.filters) {
    if (!filtersAreMeaningful(parsed.data.filters)) {
      return res.status(400).json({
        error: "Choose filters (package, city, status, …) or paste subscriber UUIDs",
      });
    }
    subscriber_ids = await fetchSubscriberIdsByFilters(req, parsed.data.filters, 500);
  }

  if (!subscriber_ids.length) {
    return res.status(400).json({ error: "No subscribers match the selected criteria" });
  }

  const settings = await getWhatsAppSettings();

  const { rows } = await query<{ id: string; phone: string | null }>(
    `SELECT s.id, c.phone
     FROM subscribers s
     LEFT JOIN customer_profiles c ON c.id = s.customer_profile_id
     WHERE s.id = ANY($1::uuid[])`,
    [subscriber_ids]
  );

  const batchId = randomUUID();
  const preview = message.length > 200 ? `${message.slice(0, 200)}…` : message;
  const items: Array<{
    chatId: string;
    text: string;
    subscriberId?: string;
    kind?: "expiry";
    sentOn?: string;
    logId?: string;
  }> = [];

  for (const r of rows) {
    const chatId = normalizePhoneToChatId(r.phone);
    if (!chatId) continue;
    const { rows: ins } = await query<{ id: string }>(
      `INSERT INTO whatsapp_delivery_log (batch_id, subscriber_id, chat_id, message_text, message_preview, kind, status)
       VALUES ($1, $2, $3, $4, $5, 'broadcast', 'queued')
       RETURNING id`,
      [batchId, r.id, chatId, message, preview]
    );
    items.push({ chatId, text: message, subscriberId: r.id, logId: ins[0].id });
  }

  if (!items.length) {
    return res.status(400).json({ error: "No subscribers with a valid phone number in profile" });
  }

  void insertAuditLog(req, {
    action: "whatsapp.broadcast",
    entityType: "whatsapp",
    details: {
      batch_id: batchId,
      queued: items.length,
      target_count: subscriber_ids.length,
      used_filters: !!parsed.data.filters,
      used_explicit_ids: !!(parsed.data.subscriber_ids?.length && !parsed.data.filters),
    },
  });

  /** Await so each row is updated to sent/failed before the HTTP response (avoids "still queued" when the host drops work after res.json). */
  try {
    await runWhatsAppBulkSend(items, settings.delay_between_ms);
  } catch (e) {
    console.error("[whatsapp] broadcast bulk send failed", e);
    return res.status(500).json({ error: "Broadcast send failed" });
  }

  res.json({
    ok: true,
    batch_id: batchId,
    queued: items.length,
    skipped: subscriber_ids.length - items.length,
  });
});

/**
 * GET /api/whatsapp/deliveries — outbound log (admin). Optional ?status=queued|sent|failed
 */
router.get("/deliveries", adminOnly, async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const statusRaw = req.query.status;
  const statusFilter =
    statusRaw === "queued" || statusRaw === "sent" || statusRaw === "failed" ? statusRaw : null;

  const { rows } = await query<{
    id: string;
    batch_id: string;
    subscriber_id: string | null;
    chat_id: string;
    message_preview: string | null;
    kind: string;
    status: string;
    error: string | null;
    created_at: string;
    sent_at: string | null;
    subscriber_username: string | null;
  }>(
    `SELECT l.id, l.batch_id, l.subscriber_id, l.chat_id, l.message_preview, l.kind, l.status, l.error, l.created_at, l.sent_at,
            s.username AS subscriber_username
     FROM whatsapp_delivery_log l
     LEFT JOIN subscribers s ON s.id = l.subscriber_id
     WHERE ($3::text IS NULL OR l.status = $3)
     ORDER BY l.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset, statusFilter]
  );
  const { rows: countRows } = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM whatsapp_delivery_log l WHERE ($1::text IS NULL OR l.status = $1)`,
    [statusFilter]
  );
  const { rows: failedCountRows } = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM whatsapp_delivery_log WHERE status = 'failed'`
  );
  res.json({
    items: rows,
    total: Number(countRows[0]?.c ?? 0),
    failed_count: Number(failedCountRows[0]?.c ?? 0),
  });
});

const RETRY_FAILED_MAX = 500;

/**
 * POST /api/whatsapp/deliveries/retry-failed — resend all failed rows (up to RETRY_FAILED_MAX, oldest first)
 */
router.post("/deliveries/retry-failed", adminOnly, async (req, res) => {
  if (!isWahaConfigured()) return res.status(400).json({ error: "WAHA not configured" });
  const settings = await getWhatsAppSettings();
  const { rows } = await query<{ id: string; chat_id: string; message_text: string }>(
    `SELECT id, chat_id, message_text FROM whatsapp_delivery_log WHERE status = 'failed' ORDER BY created_at ASC LIMIT $1`,
    [RETRY_FAILED_MAX]
  );
  if (!rows.length) {
    return res.json({ ok: true, retried: 0 });
  }
  const ids = rows.map((r) => r.id);
  await query(`UPDATE whatsapp_delivery_log SET status = 'queued', error = NULL, sent_at = NULL WHERE id = ANY($1::uuid[])`, [
    ids,
  ]);
  const items = rows.map((r) => ({
    chatId: r.chat_id,
    text: r.message_text,
    logId: r.id,
  }));
  void insertAuditLog(req, {
    action: "whatsapp.delivery.retry_all_failed",
    entityType: "whatsapp_delivery_log",
    details: { count: rows.length },
  });
  try {
    await runWhatsAppBulkSend(items, settings.delay_between_ms);
  } catch (e) {
    console.error("[whatsapp] retry-all-failed send failed", e);
    return res.status(500).json({ error: "Retry failed" });
  }
  res.json({ ok: true, retried: rows.length });
});

const bulkDeleteBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * POST /api/whatsapp/deliveries/bulk-delete — remove many log rows (admin)
 */
router.post("/deliveries/bulk-delete", adminOnly, async (req, res) => {
  const parsed = bulkDeleteBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { ids } = parsed.data;
  const r = await query(`DELETE FROM whatsapp_delivery_log WHERE id = ANY($1::uuid[])`, [ids]);
  void insertAuditLog(req, {
    action: "whatsapp.delivery.bulk_delete",
    entityType: "whatsapp_delivery_log",
    details: { count: ids.length },
  });
  res.json({ ok: true, deleted: r.rowCount ?? 0 });
});

/**
 * POST /api/whatsapp/deliveries/purge-stale — delete rows older than retention (same rule as automatic cleanup)
 */
router.post("/deliveries/purge-stale", adminOnly, async (req, res) => {
  const deleted = await purgeWhatsAppDeliveryLogOlderThanRetention();
  void insertAuditLog(req, {
    action: "whatsapp.delivery.purge_stale",
    entityType: "whatsapp_delivery_log",
    details: { deleted },
  });
  res.json({ ok: true, deleted });
});

/**
 * POST /api/whatsapp/deliveries/:id/retry — re-queue a failed send (admin)
 */
router.post("/deliveries/:id/retry", adminOnly, async (req, res) => {
  if (!isWahaConfigured()) return res.status(400).json({ error: "WAHA not configured" });
  const id = req.params.id;
  const { rows } = await query<{
    id: string;
    chat_id: string;
    message_text: string;
    status: string;
  }>(`SELECT id, chat_id, message_text, status FROM whatsapp_delivery_log WHERE id = $1::uuid`, [id]);
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  if (rows[0].status !== "failed") {
    return res.status(400).json({ error: "Only failed deliveries can be retried" });
  }
  await query(`UPDATE whatsapp_delivery_log SET status = 'queued', error = NULL, sent_at = NULL WHERE id = $1::uuid`, [
    id,
  ]);
  void insertAuditLog(req, {
    action: "whatsapp.delivery.retry",
    entityType: "whatsapp_delivery_log",
    details: { id },
  });
  res.json({ ok: true });

  void runWhatsAppBulkSend(
    [{ chatId: rows[0].chat_id, text: rows[0].message_text, logId: rows[0].id }],
    0
  ).catch((e) => console.error("[whatsapp] retry send failed", e));
});

/**
 * DELETE /api/whatsapp/deliveries/:id — remove log row (admin)
 */
router.delete("/deliveries/:id", adminOnly, async (req, res) => {
  const id = req.params.id;
  const { rowCount } = await query(`DELETE FROM whatsapp_delivery_log WHERE id = $1::uuid`, [id]);
  if (!rowCount) return res.status(404).json({ error: "Not found" });
  void insertAuditLog(req, {
    action: "whatsapp.delivery.delete",
    entityType: "whatsapp_delivery_log",
    details: { id },
  });
  res.json({ ok: true });
});

type WahaSession = {
  name?: string;
  status?: string;
  me?: { id?: string; pushName?: string } | null;
};

/**
 * GET /api/whatsapp/status — WAHA reachability + session state (admin)
 */
router.get("/status", adminOnly, async (_req, res) => {
  if (!isWahaConfigured()) {
    return res.json({
      configured: false,
      reachable: false,
      sessionName: config.wahaSessionName,
      session: null as WahaSession | null,
    });
  }
  try {
    const r = await wahaFetch(wahaSessionPath(config.wahaSessionName));
    if (r.status === 404) {
      return res.json({
        configured: true,
        reachable: true,
        sessionName: config.wahaSessionName,
        session: { exists: false as const },
      });
    }
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: "WAHA returned an error", detail: t.slice(0, 400) });
    }
    const session = (await r.json()) as WahaSession;
    return res.json({
      configured: true,
      reachable: true,
      sessionName: config.wahaSessionName,
      session: { exists: true as const, ...session },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(503).json({ configured: true, reachable: false, error: msg });
  }
});

/**
 * POST /api/whatsapp/session/ensure — create session if missing, start if stopped (admin)
 */
router.post("/session/ensure", adminOnly, async (_req, res) => {
  if (!isWahaConfigured()) return res.status(400).json({ error: "WAHA not configured" });
  const name = config.wahaSessionName;
  try {
    const ensured = await ensureWahaSessionReady();
    if (!ensured.ok) {
      return res.status(ensured.statusCode ?? 502).json({ error: ensured.error, detail: ensured.detail });
    }
    const r = await wahaFetch(wahaSessionPath(name));
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: "WAHA session lookup failed", detail: t.slice(0, 400) });
    }
    const session = (await r.json()) as WahaSession;
    return res.json({ ok: true, created: ensured.created, session });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(503).json({ error: msg });
  }
});

/**
 * POST /api/whatsapp/session/restart (admin)
 */
router.post("/session/restart", adminOnly, async (_req, res) => {
  if (!isWahaConfigured()) return res.status(400).json({ error: "WAHA not configured" });
  const name = config.wahaSessionName;
  try {
    const r = await wahaFetch(`${wahaSessionPath(name)}/restart`, { method: "POST" });
    const text = await r.text();
    if (!r.ok) return res.status(502).json({ error: "WAHA restart failed", detail: text.slice(0, 400) });
    try {
      return res.json({ ok: true, session: JSON.parse(text) as WahaSession });
    } catch {
      return res.json({ ok: true, raw: text });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(503).json({ error: msg });
  }
});

/**
 * POST /api/whatsapp/session/logout — unlink WhatsApp (admin)
 */
router.post("/session/logout", adminOnly, async (_req, res) => {
  if (!isWahaConfigured()) return res.status(400).json({ error: "WAHA not configured" });
  const name = config.wahaSessionName;
  try {
    const r = await wahaFetch(`${wahaSessionPath(name)}/logout`, { method: "POST" });
    const text = await r.text();
    if (!r.ok && r.status !== 404) {
      return res.status(502).json({ error: "WAHA logout failed", detail: text.slice(0, 400) });
    }
    return res.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(503).json({ error: msg });
  }
});

/**
 * GET /api/whatsapp/qr — PNG QR for linking (proxied from WAHA, admin)
 */
router.get("/qr", adminOnly, async (_req, res) => {
  if (!isWahaConfigured()) return res.status(400).json({ error: "WAHA not configured" });
  const name = config.wahaSessionName;
  try {
    const r = await wahaFetch(`/api/${encodeURIComponent(name)}/auth/qr`);
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: "QR not available", detail: t.slice(0, 400) });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(503).json({ error: msg });
  }
});

/**
 * GET /api/whatsapp/me — linked account info when WORKING (admin)
 */
router.get("/me", adminOnly, async (_req, res) => {
  if (!isWahaConfigured()) return res.status(400).json({ error: "WAHA not configured" });
  const j = await wahaJson<WahaSession>(`${wahaSessionPath(config.wahaSessionName)}/me`);
  if (!j.ok) return res.status(j.status === 404 ? 404 : 502).json({ error: j.text || "Failed" });
  return res.json(j.data);
});

export default router;
