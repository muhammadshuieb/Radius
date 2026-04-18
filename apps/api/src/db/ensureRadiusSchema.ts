import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** All four must exist — old DBs sometimes had only radacct, which breaks ensureAppSchema (ALTER radcheck). */
export async function radiusAccountingTablesExist(): Promise<boolean> {
  const { rows } = await query<{ c: string }>(
    `SELECT count(*)::text AS c FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('radacct','radcheck','radreply','user_usage_daily')`
  );
  return Number(rows[0]?.c ?? 0) >= 4;
}

/**
 * If RADIUS tables are incomplete (old Postgres volume), apply bundled SQL (idempotent IF NOT EXISTS).
 * Called from API + worker startup.
 */
export async function ensureRadiusAccountingSchema(): Promise<void> {
  if (await radiusAccountingTablesExist()) return;
  const sqlPath = path.join(__dirname, "../../sql/radius_accounting.sql");
  let sql: string;
  try {
    sql = readFileSync(sqlPath, "utf8");
  } catch (e) {
    throw new Error(`[ensureRadiusAccountingSchema] Could not read ${sqlPath}`, { cause: e });
  }
  const stripped = sql.replace(/^--[^\r\n]*(\r\n|\n|\r)/gm, "");
  const statements = stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await query(stmt);
  }
  if (!(await radiusAccountingTablesExist())) {
    throw new Error(
      "[ensureRadiusAccountingSchema] RADIUS tables still incomplete after apply (need radacct, radcheck, radreply, user_usage_daily)."
    );
  }
  console.log("[ensureRadiusAccountingSchema] radacct / radcheck / radreply / user_usage_daily ready");
}
