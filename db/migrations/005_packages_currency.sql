-- Package list price currency (ISO 4217)

ALTER TABLE packages ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'USD';
