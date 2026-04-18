import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { config } from "../config.js";
import { query } from "../db/pool.js";

const FOLDER_NAME = "Radius Backups";
const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

type DriveApi = {
  files: {
    create: (params: unknown) => Promise<{ data: { id?: string } }>;
    delete: (params: { fileId: string }) => Promise<unknown>;
    get: (params: { fileId: string; alt?: string }, options?: { responseType?: string }) => Promise<{ data: Readable }>;
  };
};

function loadServiceAccountJson(): Record<string, unknown> | null {
  const raw = config.googleServiceAccountJson?.trim();
  if (!raw) return null;
  try {
    if (raw.startsWith("{")) return JSON.parse(raw) as Record<string, unknown>;
    if (existsSync(raw)) return JSON.parse(readFileSync(raw, "utf8")) as Record<string, unknown>;
  } catch (e) {
    console.warn("[googleDrive] invalid GOOGLE_SERVICE_ACCOUNT_JSON:", e);
  }
  return null;
}

async function getDriveFromServiceAccount(): Promise<{ drive: DriveApi; folderId: string } | null> {
  const creds = loadServiceAccountJson();
  if (!creds) return null;
  const folderId = config.googleDriveFolderId?.trim();
  if (!folderId) {
    console.warn("[googleDrive] GOOGLE_DRIVE_FOLDER_ID is required when using a service account");
    return null;
  }
  const { google } = await import("googleapis");
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth }) as unknown as DriveApi;
  return { drive, folderId };
}

async function getDriveFromOAuth(): Promise<{ drive: DriveApi; folderId: string } | null> {
  const { rows } = await query<{ google_oauth_refresh_token: string | null; google_drive_folder_id: string | null }>(
    `SELECT google_oauth_refresh_token, google_drive_folder_id FROM maintenance_settings WHERE id = 1`
  );
  const refresh = rows[0]?.google_oauth_refresh_token?.trim();
  if (!refresh) return null;
  const { google } = await import("googleapis");
  const oauth2 = new google.auth.OAuth2(
    config.googleClientId || undefined,
    config.googleClientSecret || undefined,
    config.googleRedirectUri || undefined
  );
  oauth2.setCredentials({ refresh_token: refresh });
  let folderId = rows[0]?.google_drive_folder_id?.trim() ?? "";
  const drive = google.drive({ version: "v3", auth: oauth2 }) as unknown as DriveApi;
  if (!folderId) {
    const created = await drive.files.create({
      requestBody: { name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" },
      fields: "id",
    });
    folderId = created.data.id ?? "";
    if (!folderId) throw new Error("Could not create Drive folder");
    await query(`UPDATE maintenance_settings SET google_drive_folder_id = $1, updated_at = now() WHERE id = 1`, [
      folderId,
    ]);
  }
  return { drive, folderId };
}

export type DriveMode = "none" | "service_account" | "oauth";

export async function resolveDriveContext(): Promise<
  | { mode: "none" }
  | { mode: "service_account"; drive: DriveApi; folderId: string }
  | { mode: "oauth"; drive: DriveApi; folderId: string }
> {
  const sa = await getDriveFromServiceAccount();
  if (sa) return { mode: "service_account", ...sa };
  const oa = await getDriveFromOAuth();
  if (oa) return { mode: "oauth", ...oa };
  return { mode: "none" };
}

export async function uploadBackupToDrive(localPath: string, filename: string): Promise<{ fileId: string }> {
  const ctx = await resolveDriveContext();
  if (ctx.mode === "none") throw new Error("Google Drive is not configured");
  const { drive, folderId } = ctx;
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { body: createReadStream(localPath) },
    fields: "id",
  });
  const id = res.data.id;
  if (!id) throw new Error("Drive upload returned no file id");
  return { fileId: id };
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  const ctx = await resolveDriveContext();
  if (ctx.mode === "none") return;
  const { drive } = ctx;
  try {
    await drive.files.delete({ fileId });
  } catch (e) {
    console.warn("[googleDrive] delete failed", fileId, e);
  }
}

export async function downloadDriveFileToPath(fileId: string, destPath: string): Promise<void> {
  const ctx = await resolveDriveContext();
  if (ctx.mode === "none") throw new Error("Google Drive is not configured");
  const { drive } = ctx;
  const res = (await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" })) as {
    data: Readable;
  };
  await pipeline(res.data, createWriteStream(destPath));
}

export async function getDriveStatusSummary(): Promise<{
  mode: DriveMode;
  connected: boolean;
  email: string | null;
  folderId: string | null;
  oauthConfigured: boolean;
}> {
  const sa = loadServiceAccountJson();
  if (sa && config.googleDriveFolderId?.trim()) {
    return {
      mode: "service_account",
      connected: true,
      email: null,
      folderId: config.googleDriveFolderId.trim(),
      oauthConfigured: false,
    };
  }
  const { rows } = await query<{ google_oauth_refresh_token: string | null; google_oauth_email: string | null; google_drive_folder_id: string | null }>(
    `SELECT google_oauth_refresh_token, google_oauth_email, google_drive_folder_id FROM maintenance_settings WHERE id = 1`
  );
  const r = rows[0];
  const hasOAuth = !!r?.google_oauth_refresh_token?.trim();
  return {
    mode: hasOAuth ? "oauth" : "none",
    connected: hasOAuth,
    email: r?.google_oauth_email ?? null,
    folderId: r?.google_drive_folder_id ?? null,
    oauthConfigured: !!(config.googleClientId && config.googleClientSecret),
  };
}

export async function buildGoogleAuthUrl(state: string): Promise<string> {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set for OAuth");
  }
  const { google } = await import("googleapis");
  const oauth2 = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri
  );
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: DRIVE_SCOPES,
    state,
  });
}
