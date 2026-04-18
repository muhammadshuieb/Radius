import type { Request } from "express";
import { getSchemaFlagsSync } from "../db/schemaFlags.js";

/**
 * SQL fragment + params: subscribers whose profile city matches the manager's scope.
 * @param paramIndex placeholder index for the city parameter (e.g. 2 when $1 is already used in the same query).
 */
export function subscriberCityScope(
  tableAlias: string,
  req: Request,
  paramIndex = 1
): { sql: string; params: unknown[] } {
  const u = req.user;
  if (!u || u.role !== "manager") {
    return { sql: "TRUE", params: [] };
  }
  if (!getSchemaFlagsSync().customer_city) {
    return { sql: "TRUE", params: [] };
  }
  if (!u.scope_city?.trim()) {
    return { sql: "FALSE", params: [] };
  }
  const ph = `$${paramIndex}`;
  return {
    sql: `EXISTS (
      SELECT 1 FROM customer_profiles c
      WHERE c.id = ${tableAlias}.customer_profile_id
        AND lower(trim(coalesce(c.city, ''))) = lower(trim(${ph}::text))
    )`,
    params: [u.scope_city.trim()],
  };
}
