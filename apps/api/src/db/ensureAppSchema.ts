import { refreshSchemaFlags } from "./schemaFlags.js";
import { query } from "./pool.js";
import { DEFAULT_TENANT_ID } from "../constants/tenant.js";

/**
 * Idempotent schema tweaks (columns first, then enum) for upgrades without full re-init.
 */
export async function ensureAppSchema(): Promise<void> {
  await query(`ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS scope_city VARCHAR(120)`);
  await query(`ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS city VARCHAR(120)`);
  await query(`ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS nickname VARCHAR(120)`);
  await query(
    `ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS connection_type VARCHAR(16) NOT NULL DEFAULT 'pppoe'`
  );
  await query(`ALTER TABLE packages ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'USD'`);

  await query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'financial_tx_type') THEN
        CREATE TYPE financial_tx_type AS ENUM ('deposit', 'withdraw', 'invoice', 'adjustment');
      END IF;
    END $$;
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS financial_transactions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      staff_user_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
      type financial_tx_type NOT NULL,
      amount NUMERIC(14, 2) NOT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'USD',
      notes TEXT,
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_fin_tx_subscriber ON financial_transactions(subscriber_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_fin_tx_created ON financial_transactions(created_at)`);

  await query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS last_logout_at TIMESTAMPTZ`);
  await query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS current_ip VARCHAR(64)`);
  await query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT false`);
  await query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS nas_name VARCHAR(255)`);
  await query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES staff_users(id) ON DELETE SET NULL`);
  await query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS mac_lock VARCHAR(64)`);
  await query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS ip_lock VARCHAR(64)`);
  await query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS ip_pool VARCHAR(128)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_subscribers_created_by ON subscribers(created_by)`);

  await query(`
    CREATE TABLE IF NOT EXISTS subscriber_renewal_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
      staff_user_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
      invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
      amount NUMERIC(14, 2),
      currency CHAR(3) NOT NULL DEFAULT 'USD',
      expires_before TIMESTAMPTZ,
      expires_after TIMESTAMPTZ NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_sub_renewal_sub ON subscriber_renewal_logs(subscriber_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sub_renewal_created ON subscriber_renewal_logs(created_at)`);

  await query(`
    CREATE TABLE IF NOT EXISTS whatsapp_notification_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      company_name TEXT NOT NULL DEFAULT 'Company',
      template_renewal TEXT NOT NULL DEFAULT 'Hello {username}, your service was renewed. {company}. New expiry: {expires_at}.',
      template_new_user TEXT NOT NULL DEFAULT 'Welcome {username} at {company}. Your account is active. Expires: {expires_at}.',
      template_expiry TEXT NOT NULL DEFAULT 'Reminder {username}: subscription expires on {expires_at} ({days_left} days). — {company}',
      template_credit TEXT NOT NULL DEFAULT 'Hello {username}, credit balance: {balance}. — {company}',
      template_debt TEXT NOT NULL DEFAULT 'Hello {username}, outstanding balance: {balance}. — {company}',
      expiry_days_before INTEGER NOT NULL DEFAULT 7 CHECK (expiry_days_before >= 1 AND expiry_days_before <= 90),
      send_hour INTEGER NOT NULL DEFAULT 12 CHECK (send_hour >= 0 AND send_hour <= 23),
      send_minute INTEGER NOT NULL DEFAULT 0 CHECK (send_minute >= 0 AND send_minute <= 59),
      timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh',
      delay_between_ms INTEGER NOT NULL DEFAULT 8000 CHECK (delay_between_ms >= 500),
      notify_renewal BOOLEAN NOT NULL DEFAULT true,
      notify_new_user BOOLEAN NOT NULL DEFAULT true,
      notify_expiry BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query(
    `INSERT INTO whatsapp_notification_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`
  );
  await query(`
    CREATE TABLE IF NOT EXISTS whatsapp_sent_log (
      subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      sent_on DATE NOT NULL,
      PRIMARY KEY (subscriber_id, kind, sent_on)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS whatsapp_delivery_log (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      batch_id UUID NOT NULL,
      subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      chat_id TEXT NOT NULL,
      message_text TEXT NOT NULL,
      message_preview TEXT,
      kind VARCHAR(32) NOT NULL DEFAULT 'broadcast',
      status VARCHAR(16) NOT NULL DEFAULT 'queued',
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_at TIMESTAMPTZ
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_whatsapp_delivery_log_created ON whatsapp_delivery_log(created_at DESC)`
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_delivery_log_batch ON whatsapp_delivery_log(batch_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_delivery_log_status ON whatsapp_delivery_log(status)`);

  await query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      staff_user_id UUID NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
      action VARCHAR(160) NOT NULL,
      entity_type VARCHAR(80) NOT NULL,
      entity_id VARCHAR(80),
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  /* Older DBs may have audit_logs without these columns — CREATE TABLE IF NOT EXISTS does not add them. */
  await query(
    `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS staff_user_id UUID REFERENCES staff_users(id) ON DELETE CASCADE`
  );
  await query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS action VARCHAR(160)`);
  await query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_type VARCHAR(80)`);
  await query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_id VARCHAR(80)`);
  await query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb`);
  await query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip VARCHAR(64)`);
  await query(
    `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_staff ON audit_logs(staff_user_id)`);

  try {
    await query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON e.enumtypid = t.oid
          WHERE t.typname = 'app_role' AND e.enumlabel = 'manager'
        ) THEN
          ALTER TYPE app_role ADD VALUE 'manager';
        END IF;
      END $$
    `);
  } catch (e) {
    console.warn("[ensureAppSchema] app_role enum (non-fatal):", e);
  } finally {
    try {
      await refreshSchemaFlags();
    } catch (e) {
      console.warn("[ensureAppSchema] refreshSchemaFlags:", e);
    }
  }

  await query(`
    CREATE TABLE IF NOT EXISTS maintenance_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      google_oauth_refresh_token TEXT,
      google_oauth_email TEXT,
      google_drive_folder_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query(`INSERT INTO maintenance_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  await query(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state VARCHAR(128) PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS backups (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'success', 'failure')),
      location VARCHAR(32) NOT NULL DEFAULT 'local' CHECK (location IN ('local', 'drive', 'both')),
      drive_file_id TEXT,
      size_bytes BIGINT,
      error_message TEXT,
      deleted_at TIMESTAMPTZ
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_backups_active_created ON backups(created_at DESC) WHERE deleted_at IS NULL`
  );

  /** DMA (Radius Manager) migration: extra snapshot + origin marker on subscribers */
  await query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS dma_legacy JSONB`);
  await query(
    `ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS import_source VARCHAR(32) NOT NULL DEFAULT 'saas'`
  );

  /** Map DMA rm_users.groupid → packages.id */
  await query(`
    CREATE TABLE IF NOT EXISTS dma_group_package_map (
      dma_group_id INTEGER PRIMARY KEY,
      package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE
    )
  `);

  /** Raw rows from DMA export (JSON); migrate job fills subscribers + sets migrated_subscriber_id */
  await query(`
    CREATE TABLE IF NOT EXISTS dma_import_staging (
      id BIGSERIAL PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      migrated_subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
      migrated_at TIMESTAMPTZ,
      error_message TEXT
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_dma_staging_pending ON dma_import_staging(id) WHERE migrated_subscriber_id IS NULL`);

  /** Multi-tenant + accounting cache (see services/accounting.service.ts, radius.service.ts) */
  await query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name VARCHAR(200) NOT NULL DEFAULT 'Default',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query(
    `INSERT INTO tenants (id, name) VALUES ($1::uuid, 'Default') ON CONFLICT (id) DO NOTHING`,
    [DEFAULT_TENANT_ID]
  );

  await query(
    `ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL`
  );
  await query(
    `UPDATE staff_users SET tenant_id = $1::uuid WHERE tenant_id IS NULL`,
    [DEFAULT_TENANT_ID]
  );

  await query(
    `ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT`
  );
  await query(`UPDATE subscribers SET tenant_id = $1::uuid WHERE tenant_id IS NULL`, [DEFAULT_TENANT_ID]);
  await query(
    `ALTER TABLE subscribers ALTER COLUMN tenant_id SET DEFAULT '${DEFAULT_TENANT_ID}'::uuid`
  );
  await query(`ALTER TABLE subscribers ALTER COLUMN tenant_id SET NOT NULL`);
  try {
    await query(`ALTER TABLE subscribers DROP CONSTRAINT IF EXISTS subscribers_username_key`);
  } catch {
    /* ignore */
  }
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_subscribers_tenant_username ON subscribers (tenant_id, (lower(btrim(username))))`
  );

  await query(`ALTER TABLE packages ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT`);
  await query(`UPDATE packages SET tenant_id = $1::uuid WHERE tenant_id IS NULL`, [DEFAULT_TENANT_ID]);
  await query(`ALTER TABLE packages ALTER COLUMN tenant_id SET DEFAULT '${DEFAULT_TENANT_ID}'::uuid`);
  await query(`ALTER TABLE packages ALTER COLUMN tenant_id SET NOT NULL`);

  await query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL`);
  await query(
    `UPDATE invoices i SET tenant_id = s.tenant_id FROM subscribers s WHERE i.subscriber_id = s.id AND i.tenant_id IS NULL`
  );
  await query(`UPDATE invoices SET tenant_id = $1::uuid WHERE tenant_id IS NULL`, [DEFAULT_TENANT_ID]);

  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL`);
  await query(
    `UPDATE payments p SET tenant_id = s.tenant_id FROM subscribers s WHERE p.subscriber_id = s.id AND p.tenant_id IS NULL`
  );
  await query(`UPDATE payments SET tenant_id = $1::uuid WHERE tenant_id IS NULL`, [DEFAULT_TENANT_ID]);

  await query(`ALTER TABLE radcheck ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE`);
  await query(`UPDATE radcheck SET tenant_id = $1::uuid WHERE tenant_id IS NULL`, [DEFAULT_TENANT_ID]);
  await query(`ALTER TABLE radcheck ALTER COLUMN tenant_id SET DEFAULT '${DEFAULT_TENANT_ID}'::uuid`);
  await query(`ALTER TABLE radcheck ALTER COLUMN tenant_id SET NOT NULL`);

  await query(`ALTER TABLE radreply ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE`);
  await query(`UPDATE radreply SET tenant_id = $1::uuid WHERE tenant_id IS NULL`, [DEFAULT_TENANT_ID]);
  await query(`ALTER TABLE radreply ALTER COLUMN tenant_id SET DEFAULT '${DEFAULT_TENANT_ID}'::uuid`);
  await query(`ALTER TABLE radreply ALTER COLUMN tenant_id SET NOT NULL`);

  await query(`ALTER TABLE radacct ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL`);
  await query(
    `UPDATE radacct r SET tenant_id = s.tenant_id
     FROM subscribers s
     WHERE lower(btrim(r.username)) = lower(btrim(s.username)) AND r.tenant_id IS NULL`
  );
  await query(`UPDATE radacct SET tenant_id = $1::uuid WHERE tenant_id IS NULL`, [DEFAULT_TENANT_ID]);
  await query(`ALTER TABLE radacct ALTER COLUMN tenant_id SET DEFAULT '${DEFAULT_TENANT_ID}'::uuid`);
  await query(`ALTER TABLE radacct ALTER COLUMN tenant_id SET NOT NULL`);

  await query(`
    CREATE TABLE IF NOT EXISTS user_usage_live (
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      username VARCHAR(128) NOT NULL,
      input_bytes BIGINT NOT NULL DEFAULT 0,
      output_bytes BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, username)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_user_usage_live_username ON user_usage_live ((lower(btrim(username))))`);

  await query(`
    CREATE TABLE IF NOT EXISTS accounting_sync_state (
      key TEXT PRIMARY KEY,
      value_bigint BIGINT NOT NULL DEFAULT 0
    )
  `);

  await query(
    `INSERT INTO accounting_sync_state (key, value_bigint) VALUES ('last_radacct_id', 0) ON CONFLICT (key) DO NOTHING`
  );

  await query(`ALTER TABLE user_usage_daily ADD COLUMN IF NOT EXISTS input_bytes BIGINT NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE user_usage_daily ADD COLUMN IF NOT EXISTS output_bytes BIGINT NOT NULL DEFAULT 0`);

  /** ISP NAS inventory (RADIUS / CoA health, session counts) */
  await query(`
    CREATE TABLE IF NOT EXISTS nas_servers (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(200) NOT NULL,
      ip_address INET NOT NULL,
      radius_secret_enc TEXT NOT NULL,
      coa_port INTEGER NOT NULL DEFAULT 3799,
      api_port INTEGER,
      location VARCHAR(500),
      status VARCHAR(20) NOT NULL DEFAULT 'unknown'
        CHECK (status IN ('online', 'degraded', 'offline', 'unknown')),
      last_seen TIMESTAMPTZ,
      active_sessions_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_nas_servers_tenant ON nas_servers (tenant_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_nas_servers_ip ON nas_servers (ip_address)`);
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_nas_servers_tenant_ip ON nas_servers (tenant_id, (host(ip_address)::text))`
  );

  await query(`
    CREATE TABLE IF NOT EXISTS nas_alert_log (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      nas_id UUID NOT NULL REFERENCES nas_servers(id) ON DELETE CASCADE,
      kind VARCHAR(32) NOT NULL,
      message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_nas_alert_tenant ON nas_alert_log (tenant_id, created_at DESC)`);
}
