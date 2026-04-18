import { execFileSync, execSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { deleteDriveFile, downloadDriveFileToPath, resolveDriveContext, uploadBackupToDrive } from "./googleDriveBackup.js";

export type BackupRow = {
  id: string;
  filename: string;
  file_path: string;
  created_at: string;
  status: string;
  location: string;
  drive_file_id: string | null;
  size_bytes: string | null;
  error_message: string | null;
  deleted_at: string | null;
};

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function safeBackupPath(filename: string): string {
  const base = path.join(config.backupDir, path.basename(filename));
  const resolved = path.resolve(base);
  const root = path.resolve(config.backupDir);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Invalid backup path");
  return resolved;
}

function runProc(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolveP, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stderr = "";
    p.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    p.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            `${err.message} — PostgreSQL client tools not found. On Windows install PostgreSQL or set PG_DUMP_PATH to the full path of pg_dump.exe (e.g. C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe), or set PG_BIN_DIR to the "bin" folder.`
          )
        );
        return;
      }
      reject(err);
    });
    p.on("close", (code) => resolveP({ code: code ?? 1, stderr }));
  });
}

/** Scan typical Windows install dirs for PostgreSQL bin tools */
function findPostgresBinOnWindows(toolFile: string): string | null {
  const roots = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "PostgreSQL"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "PostgreSQL"),
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let dirs: string[];
    try {
      dirs = readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    } catch {
      continue;
    }
    for (const d of dirs) {
      const candidate = path.join(root, d, "bin", toolFile);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Resolve full path when the tool exists on PATH (fixes spawn ENOENT on Windows with some Node/PATH setups). */
function tryResolveToolFromShell(tool: string): string | null {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("where", [tool], { encoding: "utf8", windowsHide: true, timeout: 8000 });
      const first = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      if (first && existsSync(first)) return first;
    } else {
      const out = execSync(`command -v ${tool}`, { encoding: "utf8", shell: "/bin/sh", timeout: 8000 });
      const p = out.trim().split("\n")[0]?.trim();
      if (p && existsSync(p)) return p;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Resolves pg_dump: PG_DUMP_PATH, then PG_BIN_DIR + pg_dump(.exe), then Windows Program Files scan,
 * then `where`/`command -v`, else bare name for PATH.
 */
export function resolvePgDumpBinary(): string {
  const explicit = process.env.PG_DUMP_PATH?.trim();
  if (explicit) return explicit;

  const binDir = process.env.PG_BIN_DIR?.trim();
  if (binDir) {
    const name = process.platform === "win32" ? "pg_dump.exe" : "pg_dump";
    const joined = path.join(binDir, name);
    if (existsSync(joined)) return joined;
  }

  if (process.platform === "win32") {
    const found = findPostgresBinOnWindows("pg_dump.exe");
    if (found) return found;
    const fromShell = tryResolveToolFromShell("pg_dump");
    if (fromShell) return fromShell;
    return "pg_dump.exe";
  }
  const fromShell = tryResolveToolFromShell("pg_dump");
  if (fromShell) return fromShell;
  return "pg_dump";
}

function resolvePsqlBinary(): string {
  const explicit = process.env.PSQL_PATH?.trim();
  if (explicit) return explicit;

  const binDir = process.env.PG_BIN_DIR?.trim();
  if (binDir) {
    const name = process.platform === "win32" ? "psql.exe" : "psql";
    const joined = path.join(binDir, name);
    if (existsSync(joined)) return joined;
  }

  if (process.platform === "win32") {
    const found = findPostgresBinOnWindows("psql.exe");
    if (found) return found;
    const fromShell = tryResolveToolFromShell("psql");
    if (fromShell) return fromShell;
    return "psql.exe";
  }
  const fromShell = tryResolveToolFromShell("psql");
  if (fromShell) return fromShell;
  return "psql";
}

function resolvePgRestoreBinary(): string {
  const explicit = process.env.PG_RESTORE_PATH?.trim();
  if (explicit) return explicit;

  const binDir = process.env.PG_BIN_DIR?.trim();
  if (binDir) {
    const name = process.platform === "win32" ? "pg_restore.exe" : "pg_restore";
    const joined = path.join(binDir, name);
    if (existsSync(joined)) return joined;
  }

  if (process.platform === "win32") {
    const found = findPostgresBinOnWindows("pg_restore.exe");
    if (found) return found;
    const fromShell = tryResolveToolFromShell("pg_restore");
    if (fromShell) return fromShell;
    return "pg_restore.exe";
  }
  const fromShell = tryResolveToolFromShell("pg_restore");
  if (fromShell) return fromShell;
  return "pg_restore";
}

/** Custom-format pg_dump archives start with this magic (first 5 bytes). */
export function detectPgDumpFileKind(filePath: string): "custom" | "sql" {
  try {
    const st = statSync(filePath);
    if (st.size < 5) return "sql";
    const fd = openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(5);
      readSync(fd, buf, 0, 5, 0);
      if (buf.toString("ascii") === "PGDMP") return "custom";
    } finally {
      closeSync(fd);
    }
  } catch {
    return "sql";
  }
  return "sql";
}

export async function runPgRestoreFromCustomFile(filePath: string): Promise<void> {
  const bin = resolvePgRestoreBinary();
  const { code, stderr } = await runProc(bin, [
    "--no-owner",
    "--clean",
    "--if-exists",
    "-d",
    config.databaseUrl,
    filePath,
  ]);
  if (code !== 0) throw new Error(stderr.trim() || `pg_restore exited ${code}`);
}

/** Plain SQL (psql) or PostgreSQL custom archive (pg_restore). */
export async function restoreDatabaseFromSqlOrCustomFile(filePath: string): Promise<void> {
  const kind = detectPgDumpFileKind(filePath);
  if (kind === "custom") {
    await runPgRestoreFromCustomFile(filePath);
  } else {
    await runPsqlRestoreFromFile(filePath);
  }
}

/** What the API will use (for /maintenance/summary diagnostics). */
export function getBackupToolPaths(): { pg_dump: string; psql: string; pg_restore: string } {
  return { pg_dump: resolvePgDumpBinary(), psql: resolvePsqlBinary(), pg_restore: resolvePgRestoreBinary() };
}

export async function runPgDumpToFile(filePath: string): Promise<void> {
  const bin = resolvePgDumpBinary();
  const { code, stderr } = await runProc(bin, [
    "--no-owner",
    "--no-acl",
    "--clean",
    "--if-exists",
    "-f",
    filePath,
    config.databaseUrl,
  ]);
  if (code !== 0) throw new Error(stderr.trim() || `pg_dump exited ${code}`);
}

export async function runPsqlRestoreFromFile(filePath: string): Promise<void> {
  const bin = resolvePsqlBinary();
  const { code, stderr } = await runProc(bin, ["-v", "ON_ERROR_STOP=1", "-f", filePath, config.databaseUrl]);
  if (code !== 0) throw new Error(stderr.trim() || `psql exited ${code}`);
}

export async function runBackupJob(source: "scheduled" | "manual"): Promise<{ backupId: string }> {
  ensureDir(config.backupDir);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `radius-backup-${ts}-${randomBytes(4).toString("hex")}.sql`;
  const filePath = path.join(config.backupDir, filename);

  const ins = await query<{ id: string }>(
    `INSERT INTO backups (filename, file_path, status, location)
     VALUES ($1, $2, 'pending', 'local')
     RETURNING id`,
    [filename, filePath]
  );
  const backupId = ins.rows[0]?.id;
  if (!backupId) throw new Error("Could not create backup row");

  let driveErr: string | null = null;
  let driveFileId: string | null = null;
  let location: "local" | "drive" | "both" = "local";

  try {
    await runPgDumpToFile(filePath);
    const st = statSync(filePath);
    const size = st.size;

    const ctx = await resolveDriveContext();
    if (ctx.mode !== "none") {
      try {
        const up = await uploadBackupToDrive(filePath, filename);
        driveFileId = up.fileId;
        location = "both";
      } catch (e) {
        driveErr = e instanceof Error ? e.message : String(e);
        location = "local";
      }
    }

    await query(
      `UPDATE backups
       SET status = 'success',
           location = $2,
           drive_file_id = $3,
           size_bytes = $4,
           error_message = $5
       WHERE id = $1::uuid`,
      [backupId, location, driveFileId, size, driveErr]
    );

    console.log(`[backup] ${source} backup ${backupId} ok (${location})`);
    return { backupId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await query(
      `UPDATE backups SET status = 'failure', error_message = $2 WHERE id = $1::uuid`,
      [backupId, msg]
    );
    try {
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

export async function runRetentionCleanup(): Promise<{ removed: number }> {
  const days = config.backupRetentionDays;
  const { rows } = await query<BackupRow>(
    `SELECT id, filename, file_path, drive_file_id, created_at
     FROM backups
     WHERE deleted_at IS NULL
       AND created_at < now() - ($1::int * interval '1 day')`,
    [days]
  );

  let n = 0;
  for (const r of rows) {
    try {
      if (existsSync(r.file_path)) {
        try {
          unlinkSync(r.file_path);
        } catch (e) {
          console.warn("[backup] local delete", r.file_path, e);
        }
      }
      if (r.drive_file_id) {
        await deleteDriveFile(r.drive_file_id);
      }
      await query(`UPDATE backups SET deleted_at = now() WHERE id = $1::uuid`, [r.id]);
      n += 1;
    } catch (e) {
      console.warn("[backup] retention row failed", r.id, e);
    }
  }
  if (n > 0) console.log(`[backup] retention: soft-deleted ${n} backup(s) older than ${days}d`);
  return { removed: n };
}

export async function getBackupById(id: string): Promise<BackupRow | null> {
  const { rows } = await query<BackupRow>(`SELECT * FROM backups WHERE id = $1::uuid`, [id]);
  return rows[0] ?? null;
}

export async function listBackups(includeDeleted = false): Promise<BackupRow[]> {
  const sql = includeDeleted
    ? `SELECT * FROM backups ORDER BY created_at DESC LIMIT 200`
    : `SELECT * FROM backups WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`;
  const { rows } = await query<BackupRow>(sql);
  return rows;
}

export async function getLatestBackup(): Promise<BackupRow | null> {
  const { rows } = await query<BackupRow>(
    `SELECT * FROM backups WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`
  );
  return rows[0] ?? null;
}

export async function resolveRestorePath(row: BackupRow): Promise<{ path: string; temp: boolean }> {
  if (existsSync(row.file_path)) return { path: row.file_path, temp: false };
  if (!row.drive_file_id) throw new Error("Backup file is missing and no Drive copy exists");
  ensureDir(config.backupDir);
  const tmp = path.join(config.backupDir, `.restore-${row.id}.sql`);
  await downloadDriveFileToPath(row.drive_file_id, tmp);
  return { path: tmp, temp: true };
}

export async function restoreDatabaseFromBackup(backupId: string): Promise<void> {
  const row = await getBackupById(backupId);
  if (!row || row.deleted_at) throw new Error("Backup not found");
  if (row.status !== "success") throw new Error("Backup is not in success state");
  const { path: p, temp } = await resolveRestorePath(row);
  try {
    await runPsqlRestoreFromFile(p);
  } finally {
    if (temp) {
      try {
        unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}

export function verifyDownloadPath(storedPath: string, filename: string): string {
  const expected = safeBackupPath(filename);
  if (path.normalize(storedPath) !== path.normalize(expected)) throw new Error("Path mismatch");
  if (!existsSync(expected)) throw new Error("File not found");
  return expected;
}

export function purgeStaleOauthStates(): Promise<unknown> {
  return query(`DELETE FROM oauth_states WHERE created_at < now() - interval '1 hour'`);
}

export function makeOAuthStateToken(): string {
  return randomBytes(32).toString("hex");
}
