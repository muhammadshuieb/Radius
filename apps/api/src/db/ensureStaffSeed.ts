import bcrypt from "bcryptjs";
import { DEFAULT_TENANT_ID } from "../constants/tenant.js";
import { query } from "./pool.js";

/**
 * If no staff row exists (fresh DB / forgot db:seed), create the default admin so login works.
 */
export async function ensureDefaultStaffUser(): Promise<void> {
  const { rows } = await query<{ c: string }>(`SELECT count(*)::text AS c FROM staff_users`);
  if (Number(rows[0]?.c ?? 0) > 0) return;

  const email = process.env.SEED_ADMIN_EMAIL || "admin@local.test";
  const password = process.env.SEED_ADMIN_PASSWORD || "Admin123!";
  const hash = await bcrypt.hash(password, 10);
  await query(
    `INSERT INTO staff_users (email, password_hash, full_name, role, is_active, tenant_id)
     VALUES ($1, $2, 'System Admin', 'admin', true, $3::uuid)`,
    [email, hash, DEFAULT_TENANT_ID]
  );
  console.log(`[ensureDefaultStaffUser] Created first admin: ${email} (password from env or default Admin123!)`);
}
