import { query } from "./pool.js";

export type SchemaFlags = {
  staff_scope_city: boolean;
  customer_nickname: boolean;
  customer_city: boolean;
};

let cache: SchemaFlags | null = null;

/** Safe before refresh completes (e.g. tests); treats missing columns as absent. */
export function getSchemaFlagsSync(): SchemaFlags {
  return cache ?? { staff_scope_city: false, customer_nickname: false, customer_city: false };
}

/**
 * Detect optional columns (for DB volumes created before migrations).
 * Refreshed after ensureAppSchema on startup.
 */
export async function refreshSchemaFlags(): Promise<SchemaFlags> {
  const { rows } = await query<{
    staff_scope_city: boolean;
    customer_nickname: boolean;
    customer_city: boolean;
  }>(
    `SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'staff_users' AND column_name = 'scope_city'
      ) AS staff_scope_city,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'customer_profiles' AND column_name = 'nickname'
      ) AS customer_nickname,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'customer_profiles' AND column_name = 'city'
      ) AS customer_city`
  );
  cache = {
    staff_scope_city: !!rows[0]?.staff_scope_city,
    customer_nickname: !!rows[0]?.customer_nickname,
    customer_city: !!rows[0]?.customer_city,
  };
  return cache;
}

export async function getSchemaFlags(): Promise<SchemaFlags> {
  if (cache) return cache;
  return refreshSchemaFlags();
}

export function clearSchemaFlagsCache(): void {
  cache = null;
}
