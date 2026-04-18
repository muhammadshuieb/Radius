import { query } from "../db/pool.js";

/** Rows older than this many days are removed (automatic + manual purge-stale). */
export const DELIVERY_LOG_RETENTION_DAYS = 5;

export async function purgeWhatsAppDeliveryLogOlderThanRetention(): Promise<number> {
  const r = await query(
    `DELETE FROM whatsapp_delivery_log WHERE created_at < now() - ($1::int * interval '1 day')`,
    [DELIVERY_LOG_RETENTION_DAYS]
  );
  return r.rowCount ?? 0;
}
