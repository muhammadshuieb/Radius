-- NAS inventory: RADIUS/CoA health, session counts, offline alerts
-- (Also applied via apps/api ensureAppSchema on startup.)

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
);

CREATE INDEX IF NOT EXISTS idx_nas_servers_tenant ON nas_servers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_nas_servers_ip ON nas_servers (ip_address);
CREATE UNIQUE INDEX IF NOT EXISTS ux_nas_servers_tenant_ip ON nas_servers (tenant_id, (host(ip_address)::text));

CREATE TABLE IF NOT EXISTS nas_alert_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nas_id UUID NOT NULL REFERENCES nas_servers(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nas_alert_tenant ON nas_alert_log (tenant_id, created_at DESC);
