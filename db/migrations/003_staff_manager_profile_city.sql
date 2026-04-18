-- Manager role, staff scope, customer profile city/nickname (idempotent)

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'app_role' AND e.enumlabel = 'manager'
  ) THEN
    ALTER TYPE app_role ADD VALUE 'manager';
  END IF;
END $$;

ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS scope_city VARCHAR(120);
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS city VARCHAR(120);
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS nickname VARCHAR(120);
