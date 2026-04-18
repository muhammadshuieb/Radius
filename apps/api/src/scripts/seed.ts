import bcrypt from "bcryptjs";
import { pool, query } from "../db/pool.js";

async function seed() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@local.test";
  const password = process.env.SEED_ADMIN_PASSWORD || "Admin123!";
  const hash = await bcrypt.hash(password, 10);

  await query(
    `INSERT INTO staff_users (email, password_hash, full_name, role, is_active)
     VALUES ($1, $2, 'System Admin', 'admin', true)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'`,
    [email, hash]
  );

  await query(
    `INSERT INTO product_categories (name) VALUES ('Routers'), ('Cables'), ('Servers')
     ON CONFLICT (name) DO NOTHING`
  );

  console.log("Seed OK. Login:", email, "/", password);
  await pool.end();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
