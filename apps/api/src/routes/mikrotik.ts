import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { encryptField } from "../lib/fieldCrypto.js";
import { authMiddleware } from "../middleware/auth.js";
import { adminOnly } from "../middleware/rbac.js";
import { testMikrotikWithRetry, validateMikrotikPort } from "../services/mikrotik.js";

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/mikrotik/servers
 */
router.get("/servers", adminOnly, async (_req, res) => {
  const { rows } = await query(
    `SELECT id, name, host, port, use_ssl, username, is_default, last_health, last_health_at, created_at FROM mikrotik_servers ORDER BY is_default DESC, name`
  );
  res.json(rows);
});

const serverSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(8728),
  use_ssl: z.boolean().default(false),
  username: z.string().min(1),
  password: z.string().min(1),
  is_default: z.boolean().optional(),
});

/**
 * POST /api/mikrotik/servers — store target (password stored as plain password_enc placeholder — encrypt in production)
 */
router.post("/servers", adminOnly, async (req, res) => {
  const parsed = serverSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const portHint = validateMikrotikPort(b.port, b.use_ssl);
  if (b.is_default) await query(`UPDATE mikrotik_servers SET is_default = false`);
  const enc = encryptField(b.password);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO mikrotik_servers (name, host, port, use_ssl, username, password_enc, is_default)
     VALUES ($1,$2,$3,$4,$5,$6, coalesce($7,false)) RETURNING id`,
    [b.name, b.host, b.port, b.use_ssl, b.username, enc, b.is_default ?? false]
  );
  res.status(201).json({ id: rows[0].id, port_validation: portHint ?? null });
});

/**
 * POST /api/mikrotik/servers/:id/test — TCP test + retries + persisted health
 */
router.post("/servers/:id/test", adminOnly, async (req, res) => {
  const { rows } = await query<{ host: string; port: number; use_ssl: boolean }>(
    `SELECT host, port, use_ssl FROM mikrotik_servers WHERE id = $1`,
    [req.params.id]
  );
  const s = rows[0];
  if (!s) return res.status(404).json({ error: "Not found" });
  const portHint = validateMikrotikPort(s.port, s.use_ssl);
  const result = await testMikrotikWithRetry(s.host, s.port, 2, 600);
  await query(
    `UPDATE mikrotik_servers SET last_health = $1::jsonb, last_health_at = now() WHERE id = $2`,
    [JSON.stringify({ ...result, port_validation: portHint }), req.params.id]
  );
  res.json({ ...result, port_validation: portHint });
});

/**
 * POST /api/mikrotik/test-body — ad-hoc test without saving
 */
router.post("/test-body", adminOnly, async (req, res) => {
  const schema = z.object({
    host: z.string().min(1),
    port: z.number().int(),
    use_ssl: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const portHint = validateMikrotikPort(parsed.data.port, parsed.data.use_ssl ?? false);
  const result = await testMikrotikWithRetry(parsed.data.host, parsed.data.port);
  res.json({ ...result, port_validation: portHint });
});

export default router;
