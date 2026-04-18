import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DMA_SQL_FILES = [
  "dma_radius_tables.sql",
  "dma_radius_tables_b.sql",
  "dma_rm_services.sql",
  "dma_rm_settings.sql",
  "dma_rm_users.sql",
];

/**
 * DMA (Radius Manager) MySQL `radius` schema — PostgreSQL equivalents.
 * Adds DMA columns to `radacct`, creates `nas`, `radgroup*`, `radippool`, `radpostauth`,
 * `radusergroup`, and all `rm_*` tables (see `db/dma_radius_*.sql`).
 * SaaS tables (`subscribers`, `packages`, …) are unchanged.
 */
export async function ensureDmaRadiusSchema(): Promise<void> {
  const alters = [
    `ALTER TABLE radacct ADD COLUMN IF NOT EXISTS groupname VARCHAR(64) NOT NULL DEFAULT ''`,
    `ALTER TABLE radacct ADD COLUMN IF NOT EXISTS acctstartdelay BIGINT`,
    `ALTER TABLE radacct ADD COLUMN IF NOT EXISTS acctstopdelay BIGINT`,
    `ALTER TABLE radacct ADD COLUMN IF NOT EXISTS xascendsessionsvrkey VARCHAR(10)`,
    `ALTER TABLE radacct ADD COLUMN IF NOT EXISTS _accttime TIMESTAMPTZ`,
    `ALTER TABLE radacct ADD COLUMN IF NOT EXISTS _srvid INTEGER`,
    `ALTER TABLE radacct ADD COLUMN IF NOT EXISTS _dailynextsrvactive SMALLINT`,
    `ALTER TABLE radacct ADD COLUMN IF NOT EXISTS _apid INTEGER`,
  ];
  for (const s of alters) {
    try {
      await query(s);
    } catch (e) {
      console.warn("[ensureDmaRadiusSchema] radacct alter (non-fatal):", e);
    }
  }

  const idx = [
    `CREATE INDEX IF NOT EXISTS radacct__accttime ON radacct (_accttime)`,
    `CREATE INDEX IF NOT EXISTS radacct__srvid ON radacct (_srvid)`,
    `CREATE INDEX IF NOT EXISTS radacct_groupname ON radacct (groupname)`,
    `CREATE INDEX IF NOT EXISTS radacct_nasipaddress ON radacct (nasipaddress)`,
  ];
  for (const s of idx) {
    try {
      await query(s);
    } catch (e) {
      console.warn("[ensureDmaRadiusSchema] radacct index (non-fatal):", e);
    }
  }

  const baseDir = path.join(__dirname, "../../sql/dma");
  for (const name of DMA_SQL_FILES) {
    const sqlPath = path.join(baseDir, name);
    let sql: string;
    try {
      sql = readFileSync(sqlPath, "utf8");
    } catch (e) {
      console.warn(`[ensureDmaRadiusSchema] could not read ${name}:`, e);
      continue;
    }

    const chunks = sql
      .split(/\n###\s*\n/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    for (const chunk of chunks) {
      const body = chunk
        .split(/\n/)
        .filter((line) => !/^\s*--/.test(line))
        .join("\n")
        .trim();
      if (!body) continue;
      const stmt = body.endsWith(";") ? body : `${body};`;
      try {
        await query(stmt);
      } catch (e) {
        console.error(`[ensureDmaRadiusSchema] failed in ${name} (non-fatal, continuing):`, stmt.slice(0, 200), e);
      }
    }
  }

  console.log("[ensureDmaRadiusSchema] DMA-compatible RADIUS tables ready");
}
