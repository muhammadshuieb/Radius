import { mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { adminOnly } from "../middleware/rbac.js";
import { enqueueBilling } from "../queue/billingQueue.js";
import { insertAuditLog } from "../services/auditLog.js";
import {
  getBackupToolPaths,
  getLatestBackup,
  listBackups,
  makeOAuthStateToken,
  purgeStaleOauthStates,
  restoreDatabaseFromBackup,
  restoreDatabaseFromSqlOrCustomFile,
  verifyDownloadPath,
} from "../services/backupService.js";
import { buildGoogleAuthUrl, getDriveStatusSummary } from "../services/googleDriveBackup.js";
import {
  getDmaStagingStats,
  insertDmaStagingRows,
  migrateDmaStagingBatch,
} from "../services/dmaMigration.js";

const router = Router();
router.use(authMiddleware);
router.use(adminOnly);

const importRestoreUploadDir = path.join(tmpdir(), "prince-import-restore");
try {
  mkdirSync(importRestoreUploadDir, { recursive: true });
} catch {
  /* ignore */
}

const restoreUpload = multer({
  dest: importRestoreUploadDir,
  limits: { fileSize: Number(process.env.RESTORE_UPLOAD_MAX_BYTES) || 512 * 1024 * 1024 },
});

/**
 * GET /api/maintenance/backups — list (non-deleted)
 */
router.get("/backups", async (_req, res) => {
  const items = await listBackups(false);
  res.json({ items });
});

/**
 * GET /api/maintenance/summary — last backup + drive (dashboard card)
 */
router.get("/summary", async (_req, res) => {
  const last = await getLatestBackup();
  const drive = await getDriveStatusSummary();
  const tools = getBackupToolPaths();
  const driveUploadOk =
    last && (last.location === "both" || last.location === "drive") && !!last.drive_file_id;
  res.json({
    last_backup: last
      ? {
          id: last.id,
          created_at: last.created_at,
          status: last.status,
          filename: last.filename,
          location: last.location,
          drive_uploaded: driveUploadOk,
          error_message: last.error_message,
        }
      : null,
    drive: {
      mode: drive.mode,
      connected: drive.connected,
      email: drive.email,
      folder_id: drive.folderId,
      oauth_configured: drive.oauthConfigured,
    },
    /** Resolved paths the API uses for pg_dump / psql (helps debug ENOENT on Windows) */
    tools: {
      pg_dump: tools.pg_dump,
      psql: tools.psql,
      pg_restore: tools.pg_restore,
    },
  });
});

/**
 * POST /api/maintenance/backups/run — queue backup now
 */
router.post("/backups/run", async (req, res) => {
  await enqueueBilling("daily_pg_backup", { source: "manual" });
  await insertAuditLog(req, {
    action: "maintenance.backup_requested",
    entityType: "backup",
    details: { source: "manual" },
  });
  res.json({ ok: true, queued: true });
});

/**
 * GET /api/maintenance/backups/:id/download
 */
router.get("/backups/:id/download", async (req, res) => {
  const { id } = req.params;
  const { rows } = await query<{
    filename: string;
    file_path: string;
    deleted_at: string | null;
    status: string;
  }>(`SELECT filename, file_path, deleted_at, status FROM backups WHERE id = $1::uuid`, [id]);
  const row = rows[0];
  if (!row || row.deleted_at) return res.status(404).json({ error: "Backup not found" });
  if (row.status !== "success") return res.status(400).json({ error: "Backup is not available" });
  try {
    const abs = verifyDownloadPath(row.file_path, row.filename);
    res.download(abs, row.filename);
  } catch (e) {
    return res.status(404).json({ error: e instanceof Error ? e.message : "File not found" });
  }
});

/**
 * POST /api/maintenance/backups/:id/restore
 * body: { confirm: true }
 */
router.post("/backups/:id/restore", async (req, res) => {
  const { id } = req.params;
  const confirm = (req.body as { confirm?: boolean })?.confirm === true;
  if (!confirm) return res.status(400).json({ error: "confirm must be true" });
  try {
    await restoreDatabaseFromBackup(id);
    await insertAuditLog(req, {
      action: "maintenance.restore_completed",
      entityType: "backup",
      entityId: id,
      details: { ok: true },
    });
    res.json({ ok: true, status: "success" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await insertAuditLog(req, {
      action: "maintenance.restore_failed",
      entityType: "backup",
      entityId: id,
      details: { error: msg },
    });
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * POST /api/maintenance/restore/import — upload a .sql (plain) or custom pg_dump (.dump/.backup) and restore into current DATABASE_URL
 * multipart: file (required), confirm=true (required)
 */
/**
 * POST /api/maintenance/dma/staging — append rows from DMA (e.g. rm_users export as JSON array)
 */
router.post("/dma/staging", async (req, res) => {
  const rows = (req.body as { rows?: unknown }).rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "Body must be { rows: [ {...}, ... ] } with at least one object" });
  }
  if (rows.length > 5000) return res.status(400).json({ error: "Maximum 5000 rows per request" });
  const objects = rows.filter((r) => r != null && typeof r === "object") as Record<string, unknown>[];
  if (objects.length !== rows.length) {
    return res.status(400).json({ error: "Every row must be an object" });
  }
  try {
    const r = await insertDmaStagingRows(objects);
    await insertAuditLog(req, {
      action: "maintenance.dma_staging_insert",
      entityType: "dma_import",
      details: { inserted: r.inserted },
    });
    res.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/maintenance/dma/staging/stats
 */
router.get("/dma/staging/stats", async (_req, res) => {
  res.json(await getDmaStagingStats());
});

/**
 * POST /api/maintenance/dma/migrate — create subscribers from pending staging rows
 * body: { default_package_id: uuid, group_map?: { "1": "<package-uuid>", ... }, limit?: number }
 */
router.post("/dma/migrate", async (req, res) => {
  const b = req.body as {
    default_package_id?: string;
    group_map?: Record<string, string>;
    limit?: number;
  };
  if (!b.default_package_id?.trim()) {
    return res.status(400).json({ error: "default_package_id is required" });
  }
  try {
    const result = await migrateDmaStagingBatch({
      defaultPackageId: b.default_package_id.trim(),
      groupMap: b.group_map,
      limit: b.limit,
    });
    await insertAuditLog(req, {
      action: "maintenance.dma_migrate",
      entityType: "dma_import",
      details: result,
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

router.post("/restore/import", restoreUpload.single("file"), async (req, res) => {
  const file = (req as Request & { file?: { path: string; originalname: string; size: number } }).file;
  const body = req.body as { confirm?: string };
  const confirm = body?.confirm === "true" || body?.confirm === "1";
  if (!file?.path) {
    return res.status(400).json({ error: "No file uploaded (field name: file)" });
  }
  if (!confirm) {
    try {
      unlinkSync(file.path);
    } catch {
      /* ignore */
    }
    return res.status(400).json({ error: "confirm must be true (destructive restore)" });
  }
  try {
    await restoreDatabaseFromSqlOrCustomFile(file.path);
    await insertAuditLog(req, {
      action: "maintenance.restore_import_completed",
      entityType: "maintenance",
      details: { original_name: file.originalname, size: file.size },
    });
    res.json({ ok: true, status: "success" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await insertAuditLog(req, {
      action: "maintenance.restore_import_failed",
      entityType: "maintenance",
      details: { error: msg, original_name: file.originalname },
    });
    res.status(500).json({ ok: false, error: msg });
  } finally {
    try {
      unlinkSync(file.path);
    } catch {
      /* ignore */
    }
  }
});

/**
 * GET /api/maintenance/drive/status
 */
router.get("/drive/status", async (_req, res) => {
  const s = await getDriveStatusSummary();
  res.json(s);
});

/**
 * GET /api/maintenance/drive/auth-url — start OAuth (admin)
 */
router.get("/drive/auth-url", async (_req, res) => {
  try {
    await purgeStaleOauthStates();
    const state = makeOAuthStateToken();
    await query(`INSERT INTO oauth_states (state) VALUES ($1)`, [state]);
    const url = await buildGoogleAuthUrl(state);
    res.json({ url });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * DELETE /api/maintenance/drive/oauth — disconnect Google (admin)
 */
router.delete("/drive/oauth", async (req, res) => {
  await query(
    `UPDATE maintenance_settings SET google_oauth_refresh_token = NULL, google_oauth_email = NULL, google_drive_folder_id = NULL, updated_at = now() WHERE id = 1`
  );
  await insertAuditLog(req, { action: "maintenance.drive_oauth_cleared", entityType: "maintenance" });
  res.json({ ok: true });
});

export default router;

/**
 * Public: GET /api/maintenance/drive/callback — Google OAuth redirect (no JWT)
 */
export async function handleDriveOAuthCallback(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string | undefined>;
  if (q.error) {
    res.redirect(`${config.webPublicUrl}/maintenance?drive=error&reason=${encodeURIComponent(q.error)}`);
    return;
  }
  const code = q.code;
  const state = q.state;
  if (!code || !state) {
    res.redirect(`${config.webPublicUrl}/maintenance?drive=error&reason=missing_params`);
    return;
  }
  try {
    const { rows } = await query<{ state: string }>(`SELECT state FROM oauth_states WHERE state = $1`, [state]);
    if (!rows.length) {
      res.redirect(`${config.webPublicUrl}/maintenance?drive=error&reason=invalid_state`);
      return;
    }
    await query(`DELETE FROM oauth_states WHERE state = $1`, [state]);

    const { google } = await import("googleapis");
    const oauth2 = new google.auth.OAuth2(
      config.googleClientId,
      config.googleClientSecret,
      config.googleRedirectUri
    );
    const { tokens } = await oauth2.getToken(code);
    const refresh = tokens.refresh_token;
    if (!refresh) {
      res.redirect(`${config.webPublicUrl}/maintenance?drive=error&reason=no_refresh_token`);
      return;
    }
    oauth2.setCredentials(tokens);
    let email: string | null = null;
    try {
      const u = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token ?? ""}` },
      });
      if (u.ok) {
        const j = (await u.json()) as { email?: string };
        email = j.email ?? null;
      }
    } catch {
      /* ignore */
    }

    await query(
      `UPDATE maintenance_settings SET
        google_oauth_refresh_token = $1,
        google_oauth_email = $2,
        google_drive_folder_id = NULL,
        updated_at = now()
       WHERE id = 1`,
      [refresh, email]
    );

    res.redirect(`${config.webPublicUrl}/maintenance?drive=connected`);
  } catch (e) {
    console.error("[maintenance] oauth callback", e);
    res.redirect(
      `${config.webPublicUrl}/maintenance?drive=error&reason=${encodeURIComponent(
        e instanceof Error ? e.message : "oauth_failed"
      )}`
    );
  }
}
