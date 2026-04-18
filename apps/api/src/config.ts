import path from "node:path";

export const config = {
  port: Number(process.env.PORT) || 4000,
  databaseUrl: process.env.DATABASE_URL || "postgresql://prince:prince_dev_pass@localhost:5432/radius_saas",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  jwtExpires: process.env.JWT_EXPIRES || "7d",
  /** 64 hex chars (32 bytes) for AES-256-GCM; if unset, key is derived from jwtSecret (dev only). */
  fieldEncryptionKey: process.env.FIELD_ENCRYPTION_KEY || "",
  /** RADIUS CoA/Disconnect (RFC 5176) — shared secret with NAS; falls back to `nas` table when present. */
  radiusCoaSecret: process.env.RADIUS_COA_SECRET || "",
  radiusCoaPort: Number(process.env.RADIUS_COA_PORT) || 3799,
  /** Cache TTL for subscriber status / usage reads (seconds). */
  subscriberCacheTtlSec: Math.min(120, Math.max(15, Number(process.env.SUBSCRIBER_CACHE_TTL_SEC) || 45)),
  mikrotikConnectTimeoutMs: Number(process.env.MIKROTIK_TIMEOUT_MS) || 8000,
  /** WAHA (WhatsApp HTTP API) — empty means integration disabled */
  wahaBaseUrl: (process.env.WAHA_BASE_URL || "").replace(/\/$/, ""),
  wahaApiKey: process.env.WAHA_API_KEY || "",
  /** WAHA Core (free) allows only the `default` session; WAHA Plus supports custom names. */
  wahaSessionName: process.env.WAHA_SESSION_NAME || "default",

  /** Plain SQL dumps; default under cwd/backups — set BACKUP_DIR=/backups on Linux servers */
  backupDir: process.env.BACKUP_DIR || path.join(process.cwd(), "backups"),
  /** Retention window for local + Drive copies */
  backupRetentionDays: Math.min(90, Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS) || 7)),
  /** Cron (UTC, 6-field: sec min hour …) — default 02:00 */
  backupCronPattern: process.env.BACKUP_CRON_PATTERN || "0 0 2 * * *",
  backupRetentionCronPattern: process.env.BACKUP_RETENTION_CRON_PATTERN || "0 30 3 * * *",

  /** Frontend origin for OAuth redirect (no trailing slash) */
  webPublicUrl: (process.env.WEB_PUBLIC_URL || "http://localhost:5173").replace(/\/$/, ""),
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  /** Must match Google Cloud OAuth redirect URI */
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI || `http://localhost:${Number(process.env.PORT) || 4000}/api/maintenance/drive/callback`,
  /**
   * Service account JSON (raw string) or absolute path to a .json file.
   * Prefer sharing a Drive folder with the SA email and set googleDriveFolderId.
   */
  googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
  googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || "",
};
