-- PPPoE vs Hotspot hint on subscriber row (billing / future RADIUS sync)

ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS connection_type VARCHAR(16) NOT NULL DEFAULT 'pppoe';
