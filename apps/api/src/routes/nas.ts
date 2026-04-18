import { isIPv4, isIPv6 } from "node:net";
import { Router } from "express";
import { z } from "zod";
import { DEFAULT_TENANT_ID } from "../constants/tenant.js";
import { radiusAccountingTablesExist } from "../db/ensureRadiusSchema.js";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { adminOnly, anyStaff } from "../middleware/rbac.js";
import {
  encryptNasSecret,
  getNasById,
  listNasForTenant,
  runNasHealthProbe,
  updateNASStatus,
} from "../services/nas.service.js";

const router = Router();
router.use(authMiddleware);
router.use(tenantMiddleware);

const ipRefine = (s: string) => isIPv4(s) || isIPv6(s);

const createSchema = z.object({
  name: z.string().min(1).max(200),
  ip_address: z.string().refine(ipRefine, "Invalid IP address"),
  radius_secret: z.string().min(1),
  coa_port: z.number().int().min(1).max(65535).optional().default(3799),
  api_port: z.number().int().min(1).max(65535).nullable().optional(),
  location: z.string().max(500).nullable().optional(),
});

const patchSchema = createSchema.partial().omit({ radius_secret: true }).extend({
  radius_secret: z.string().min(1).optional(),
});

/**
 * GET /api/nas — list NAS for tenant
 */
router.get("/", anyStaff, async (req, res) => {
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  const rows = await listNasForTenant(tid);
  res.json(rows);
});

/**
 * POST /api/nas — create (admin)
 */
router.post("/", adminOnly, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  const enc = encryptNasSecret(b.radius_secret);
  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO nas_servers (tenant_id, name, ip_address, radius_secret_enc, coa_port, api_port, location, status)
       VALUES ($1, $2, $3::inet, $4, $5, $6, $7, 'unknown')
       RETURNING id`,
      [tid, b.name, b.ip_address, enc, b.coa_port, b.api_port ?? null, b.location ?? null]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (e: unknown) {
    const pg = e as { code?: string };
    if (pg.code === "23505") {
      return res.status(409).json({ error: "A NAS with this IP already exists for this tenant" });
    }
    throw e;
  }
});

/**
 * PUT /api/nas/:id — update (admin)
 */
router.put("/:id", adminOnly, async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  const id = req.params.id;
  const existing = await getNasById(id, tid);
  if (!existing) return res.status(404).json({ error: "Not found" });

  const fields: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (b.name !== undefined) {
    fields.push(`name = $${i++}`);
    vals.push(b.name);
  }
  if (b.ip_address !== undefined) {
    fields.push(`ip_address = $${i++}::inet`);
    vals.push(b.ip_address);
  }
  if (b.radius_secret !== undefined) {
    fields.push(`radius_secret_enc = $${i++}`);
    vals.push(encryptNasSecret(b.radius_secret));
  }
  if (b.coa_port !== undefined) {
    fields.push(`coa_port = $${i++}`);
    vals.push(b.coa_port);
  }
  if (b.api_port !== undefined) {
    fields.push(`api_port = $${i++}`);
    vals.push(b.api_port);
  }
  if (b.location !== undefined) {
    fields.push(`location = $${i++}`);
    vals.push(b.location);
  }
  if (!fields.length) return res.status(400).json({ error: "No fields" });
  vals.push(id, tid);
  try {
    await query(
      `UPDATE nas_servers SET ${fields.join(", ")} WHERE id = $${i} AND tenant_id = $${i + 1}`,
      vals
    );
  } catch (e: unknown) {
    const pg = e as { code?: string };
    if (pg.code === "23505") {
      return res.status(409).json({ error: "A NAS with this IP already exists for this tenant" });
    }
    throw e;
  }
  res.json({ ok: true });
});

/**
 * DELETE /api/nas/:id — admin
 */
router.delete("/:id", adminOnly, async (req, res) => {
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  const { rowCount } = await query(`DELETE FROM nas_servers WHERE id = $1 AND tenant_id = $2`, [
    req.params.id,
    tid,
  ]);
  if (!rowCount) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

/**
 * GET /api/nas/:id/status
 */
router.get("/:id/status", anyStaff, async (req, res) => {
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  const row = await getNasById(req.params.id, tid);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

/**
 * GET /api/nas/:id/sessions — open radacct rows for this NAS IP
 */
router.get("/:id/sessions", anyStaff, async (req, res) => {
  if (!(await radiusAccountingTablesExist())) {
    return res.json({ sessions: [], note: "radacct not available" });
  }
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  const row = await getNasById(req.params.id, tid);
  if (!row) return res.status(404).json({ error: "Not found" });
  const nip = row.ip_address.trim();
  const { rows } = await query(
    `SELECT radacctid, username, host(nasipaddress)::text AS nasipaddress, acctstarttime::text AS acctstarttime,
            acctupdatetime::text AS acctupdatetime,
            framedipaddress::text AS framedipaddress, acctsessionid, callingstationid,
            COALESCE(acctinputoctets,0)::text AS acctinputoctets,
            COALESCE(acctoutputoctets,0)::text AS acctoutputoctets
     FROM radacct
     WHERE tenant_id = $1
       AND host(nasipaddress)::text = $2
       AND acctstoptime IS NULL
     ORDER BY acctstarttime DESC NULLS LAST
     LIMIT 500`,
    [tid, nip]
  );
  res.json({ nas_ip: nip, sessions: rows });
});

/**
 * POST /api/nas/:id/test — ping + radius + coa (does not persist status)
 */
router.post("/:id/test", adminOnly, async (req, res) => {
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  const r = await runNasHealthProbe(req.params.id, tid);
  if (!r) return res.status(404).json({ error: "Not found" });
  res.json(r);
});

/**
 * POST /api/nas/:id/check-now — full health check + persist (admin)
 */
router.post("/:id/check-now", adminOnly, async (req, res) => {
  const tid = req.tenantId ?? DEFAULT_TENANT_ID;
  const row = await getNasById(req.params.id, tid);
  if (!row) return res.status(404).json({ error: "Not found" });
  const out = await updateNASStatus(req.params.id);
  res.json(out);
});

export default router;
