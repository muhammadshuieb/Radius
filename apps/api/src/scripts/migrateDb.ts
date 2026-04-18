import { ensureRadiusAccountingSchema } from "../db/ensureRadiusSchema.js";
import { pool } from "../db/pool.js";

const ok = await ensureRadiusAccountingSchema();
if (!ok) {
  console.error("Migration failed or sql/radius_accounting.sql missing.");
  process.exit(1);
}
console.log("Database schema OK (RADIUS accounting tables).");
await pool.end();
