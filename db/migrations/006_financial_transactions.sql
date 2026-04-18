-- Ledger for deposits, withdrawals, adjustments (subscriber wallet–style ops)

CREATE TYPE financial_tx_type AS ENUM ('deposit', 'withdraw', 'invoice', 'adjustment');

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
);

CREATE INDEX IF NOT EXISTS idx_fin_tx_subscriber ON financial_transactions(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_fin_tx_created ON financial_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_fin_tx_type ON financial_transactions(type);
