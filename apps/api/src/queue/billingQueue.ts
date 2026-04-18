import { Queue } from "bullmq";
import { redisConnection } from "./connection.js";

export const BILLING_QUEUE = "billing";

export const billingQueue = new Queue(BILLING_QUEUE, { connection: redisConnection });

export type BillingJobName =
  | "auto_expire_subscribers"
  | "generate_recurring_invoices"
  | "radius_accounting_cycle"
  | "aggregate_user_usage_daily"
  | "nas_health_check"
  | "daily_pg_backup"
  | "backup_retention_cleanup";

export async function enqueueBilling(name: BillingJobName, data: Record<string, unknown> = {}) {
  await billingQueue.add(name, data, { removeOnComplete: 100, removeOnFail: 50 });
}
