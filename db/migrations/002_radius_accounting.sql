-- RADIUS accounting (FreeRADIUS-compatible) + daily summary + auth tables for enforcement
-- Apply on existing DB: psql $DATABASE_URL -f db/migrations/002_radius_accounting.sql

-- radacct: FreeRADIUS default schema (PostgreSQL) — sql module accounting { sql }
CREATE TABLE IF NOT EXISTS radacct (
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

CREATE INDEX IF NOT EXISTS radacct_username_lower ON radacct ((lower(btrim(username))));
CREATE INDEX IF NOT EXISTS radacct_acctstarttime ON radacct (acctstarttime);
CREATE INDEX IF NOT EXISTS radacct_acctstoptime ON radacct (acctstoptime);
CREATE INDEX IF NOT EXISTS radacct_acctsessionid ON radacct (acctsessionid);
CREATE INDEX IF NOT EXISTS radacct_open_sessions ON radacct (lower(btrim(username))) WHERE acctstoptime IS NULL;

-- radcheck / radreply: used by FreeRADIUS authorize — enforce deletes rows here to reject new auth
CREATE TABLE IF NOT EXISTS radcheck (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(128) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op VARCHAR(2) NOT NULL DEFAULT '==',
    value VARCHAR(253) NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS radcheck_username_lower ON radcheck ((lower(btrim(username))));

CREATE TABLE IF NOT EXISTS radreply (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(128) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op VARCHAR(2) NOT NULL DEFAULT '=',
    value VARCHAR(253) NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS radreply_username_lower ON radreply ((lower(btrim(username))));

-- Daily rollup (avoid scanning full radacct on every dashboard load)
CREATE TABLE IF NOT EXISTS user_usage_daily (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(128) NOT NULL,
    usage_date DATE NOT NULL,
    used_gb DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_usage_daily_username_date UNIQUE (username, usage_date)
);
CREATE INDEX IF NOT EXISTS user_usage_daily_date ON user_usage_daily (usage_date);
