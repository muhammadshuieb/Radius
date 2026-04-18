-- ISP subscriber fields + renewal audit
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS last_logout_at TIMESTAMPTZ;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS current_ip VARCHAR(64);
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS nas_name VARCHAR(255);
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES staff_users(id) ON DELETE SET NULL;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS mac_lock VARCHAR(64);
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS ip_lock VARCHAR(64);
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS ip_pool VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_subscribers_created_by ON subscribers(created_by);

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
);

CREATE INDEX IF NOT EXISTS idx_sub_renewal_sub ON subscriber_renewal_logs(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_sub_renewal_created ON subscriber_renewal_logs(created_at);
