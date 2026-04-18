import { ensureRadiusAccountingSchema } from "../db/ensureRadiusSchema.js";
import { pool } from "../db/pool.js";

try {
  await ensureRadiusAccountingSchema();
  console.log("Database schema OK (RADIUS accounting tables).");
} catch (e) {
  console.error(e);
  process.exit(1);
}
await pool.end();
