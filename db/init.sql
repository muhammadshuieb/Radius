-- PrincE RADIUS SaaS — PostgreSQL schema
-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enums
CREATE TYPE app_role AS ENUM ('admin', 'accountant', 'viewer', 'manager');
CREATE TYPE subscriber_status AS ENUM ('active', 'expired', 'disabled');
CREATE TYPE payment_status AS ENUM ('paid', 'unpaid', 'partial');
CREATE TYPE invoice_period AS ENUM ('monthly', 'yearly', 'one_time');

-- Staff (RBAC)
CREATE TABLE staff_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(200),
    role app_role NOT NULL DEFAULT 'viewer',
    scope_city VARCHAR(120),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Packages (RADIUS product templates)
CREATE TABLE packages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(120) NOT NULL,
    speed_up VARCHAR(32) NOT NULL DEFAULT '10M',
    speed_down VARCHAR(32) NOT NULL DEFAULT '10M',
    data_limit_gb NUMERIC(12, 2), -- NULL = unlimited
    price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    currency CHAR(3) NOT NULL DEFAULT 'USD', -- ISO 4217
    duration_days INT NOT NULL DEFAULT 30,
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Customer profile (location, notes, devices)
CREATE TABLE customer_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    display_name VARCHAR(200),
    nickname VARCHAR(120),
    city VARCHAR(120),
    phone VARCHAR(64),
    notes TEXT,
    location_lat NUMERIC(10, 7),
    location_lng NUMERIC(10, 7),
    linked_devices JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subscribers = RADIUS end-users + billing slice
CREATE TABLE subscribers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(128) NOT NULL UNIQUE,
    password_hash VARCHAR(255), -- optional if Cleartext stored elsewhere
    connection_type VARCHAR(16) NOT NULL DEFAULT 'pppoe', -- pppoe | hotspot (RADIUS / MikroTik profile hint)
    package_id UUID REFERENCES packages(id),
    speed_up_override VARCHAR(32),
    speed_down_override VARCHAR(32),
    data_remaining_gb NUMERIC(12, 2),
    data_used_gb NUMERIC(12, 2) NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    status subscriber_status NOT NULL DEFAULT 'active',
    payment_status payment_status NOT NULL DEFAULT 'unpaid',
    customer_profile_id UUID REFERENCES customer_profiles(id),
    mikrotik_queue_synced_at TIMESTAMPTZ,
    last_accounting_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscribers_status ON subscribers(status);
CREATE INDEX idx_subscribers_payment ON subscribers(payment_status);
CREATE INDEX idx_subscribers_expires ON subscribers(expires_at);

-- Invoices
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
    period invoice_period NOT NULL DEFAULT 'monthly',
    title VARCHAR(255) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    status payment_status NOT NULL DEFAULT 'unpaid',
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    due_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    pdf_path VARCHAR(512),
    meta JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_invoices_subscriber ON invoices(subscriber_id);
CREATE INDEX idx_invoices_issued ON invoices(issued_at);

-- Payments (subscription renewals / user payments)
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL,
    method VARCHAR(64), -- cash, card, transfer
    reference VARCHAR(128),
    paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT
);

-- Expenses (accounting)
CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    category VARCHAR(120),
    amount NUMERIC(12, 2) NOT NULL,
    incurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT,
    created_by UUID REFERENCES staff_users(id)
);

-- Inventory
CREATE TABLE product_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(120) NOT NULL UNIQUE
);

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    category_id UUID REFERENCES product_categories(id),
    sku VARCHAR(64),
    price NUMERIC(12, 2) NOT NULL,
    stock_qty INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sales + line items
CREATE TABLE sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_label VARCHAR(255), -- free text or link subscriber
    subscriber_id UUID REFERENCES subscribers(id),
    total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    invoice_id UUID REFERENCES invoices(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES staff_users(id)
);

CREATE TABLE sale_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id),
    qty INT NOT NULL DEFAULT 1,
    unit_price NUMERIC(12, 2) NOT NULL
);

-- MikroTik API targets
CREATE TABLE mikrotik_servers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(120) NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INT NOT NULL DEFAULT 8728,
    use_ssl BOOLEAN NOT NULL DEFAULT false,
    username VARCHAR(128) NOT NULL,
    password_enc VARCHAR(512) NOT NULL, -- app-level encryption recommended
    is_default BOOLEAN NOT NULL DEFAULT false,
    last_health JSONB,
    last_health_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit log (optional)
CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_id UUID REFERENCES staff_users(id),
    action VARCHAR(64) NOT NULL,
    entity VARCHAR(64),
    entity_id UUID,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========== RADIUS accounting (FreeRADIUS sql + enforcement) ==========
CREATE TABLE radacct (
    radacctid BIGSERIAL PRIMARY KEY,
    acctsessionid VARCHAR(128) NOT NULL,
    acctuniqueid VARCHAR(128) NOT NULL UNIQUE,
    username VARCHAR(128),
    realm VARCHAR(64),
    nasipaddress INET NOT NULL DEFAULT '0.0.0.0',
    nasportid VARCHAR(32),
    nasporttype VARCHAR(32),
    acctstarttime TIMESTAMPTZ,
    acctupdatetime TIMESTAMPTZ,
    acctstoptime TIMESTAMPTZ,
    acctinterval BIGINT,
    acctsessiontime BIGINT,
    acctauthentic VARCHAR(32),
    connectinfo_start TEXT,
    connectinfo_stop TEXT,
    acctinputoctets BIGINT,
    acctoutputoctets BIGINT,
    calledstationid VARCHAR(64),
    callingstationid VARCHAR(64),
    acctterminatecause VARCHAR(32),
    servicetype VARCHAR(32),
    framedprotocol VARCHAR(32),
    framedipaddress INET,
    framedipv6address INET,
    framedipv6prefix VARCHAR(64),
    framedinterfaceid VARCHAR(32),
    delegatedipv6prefix VARCHAR(64),
    class VARCHAR(64),
    groupname VARCHAR(64) NOT NULL DEFAULT '',
    acctstartdelay BIGINT,
    acctstopdelay BIGINT,
    xascendsessionsvrkey VARCHAR(10),
    _accttime TIMESTAMPTZ,
    _srvid INTEGER,
    _dailynextsrvactive SMALLINT,
    _apid INTEGER
);

CREATE INDEX radacct_username_lower ON radacct ((lower(btrim(username))));
CREATE INDEX radacct_acctstarttime ON radacct (acctstarttime);
CREATE INDEX radacct_acctstoptime ON radacct (acctstoptime);
CREATE INDEX radacct_acctsessionid ON radacct (acctsessionid);
CREATE INDEX radacct_open_sessions ON radacct (lower(btrim(username))) WHERE acctstoptime IS NULL;

CREATE TABLE radcheck (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(128) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op VARCHAR(2) NOT NULL DEFAULT '==',
    value VARCHAR(253) NOT NULL DEFAULT ''
);
CREATE INDEX radcheck_username_lower ON radcheck ((lower(btrim(username))));

CREATE TABLE radreply (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(128) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op VARCHAR(2) NOT NULL DEFAULT '=',
    value VARCHAR(253) NOT NULL DEFAULT ''
);
CREATE INDEX radreply_username_lower ON radreply ((lower(btrim(username))));

CREATE TABLE user_usage_daily (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(128) NOT NULL,
    usage_date DATE NOT NULL,
    used_gb DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_usage_daily_username_date UNIQUE (username, usage_date)
);
CREATE INDEX user_usage_daily_date ON user_usage_daily (usage_date);

INSERT INTO packages (name, speed_up, speed_down, data_limit_gb, price, duration_days, is_default, is_active)
VALUES
    ('Basic 10M', '10M', '10M', 100, 19.99, 30, true, true),
    ('Pro 50M', '50M', '50M', 500, 49.99, 30, false, true);
