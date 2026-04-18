import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function radiusAccountingTablesExist(): Promise<boolean> {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'radacct' LIMIT 1`
  );
  return rows.length > 0;
}

/**
 * If radacct is missing (old Postgres volume), apply bundled SQL (idempotent IF NOT EXISTS).
 * Called from API + worker startup.
 */
export async function ensureRadiusAccountingSchema(): Promise<boolean> {
  if (await radiusAccountingTablesExist()) return true;
  const sqlPath = path.join(__dirname, "../../sql/radius_accounting.sql");
  let sql: string;
  try {
    sql = readFileSync(sqlPath, "utf8");
  } catch (e) {
    console.warn("[ensureRadiusAccountingSchema] Could not read sql file:", sqlPath, e);
    return false;
  }
  const stripped = sql.replace(/^--[^\r\n]*(\r\n|\n|\r)/gm, "");
  const statements = stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await query(stmt);
  }
  const ok = await radiusAccountingTablesExist();
  if (ok) console.log("[ensureRadiusAccountingSchema] radacct / radcheck / radreply / user_usage_daily ready");
  return ok;
}
