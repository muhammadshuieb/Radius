import type { Request } from "express";
import { z } from "zod";
import { subscriberCityScope } from "./managerScope.js";

/** Shared filters for subscriber list, WhatsApp broadcast targets, etc. */
export const subscriberListFilterSchema = z.object({
  search: z.string().optional(),
  status: z.enum(["active", "expired", "disabled"]).optional(),
  payment_status: z.enum(["paid", "unpaid", "partial"]).optional(),
  package_id: z.string().uuid().optional(),
  /** City / region — matches customer_profiles.city (partial, case-insensitive) */
  city: z.string().optional(),
  negative_balance: z.coerce.boolean().optional(),
  expires_from: z.string().optional(),
  expires_to: z.string().optional(),
  speed: z.string().optional(),
  low_data_gb: z.coerce.number().positive().optional(),
  expired_only: z.coerce.boolean().optional(),
  active_only: z.coerce.boolean().optional(),
});

export type SubscriberListFilters = z.infer<typeof subscriberListFilterSchema>;

export function buildSubscriberWhereClause(
  p: SubscriberListFilters,
  req: Request,
  tenantId: string
): { conditions: string[]; params: unknown[] } {
  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];
  let i = 1;

  conditions.push(`s.tenant_id = $${i++}`);
  params.push(tenantId);

  if (p.search?.trim()) {
    const term = `%${p.search.trim()}%`;
    conditions.push(
      `(s.username ILIKE $${i} OR COALESCE(c.phone, '') ILIKE $${i} OR COALESCE(c.display_name, '') ILIKE $${i})`
    );
    params.push(term);
    i++;
  }
  if (p.package_id) {
    conditions.push(`s.package_id = $${i++}`);
    params.push(p.package_id);
  }
  if (p.expires_from) {
    conditions.push(`s.expires_at >= $${i++}::timestamptz`);
    params.push(p.expires_from);
  }
  if (p.expires_to) {
    conditions.push(`s.expires_at <= $${i++}::timestamptz`);
    params.push(p.expires_to);
  }
  if (p.status) {
    conditions.push(`s.status = $${i++}`);
    params.push(p.status);
  }
  if (p.payment_status) {
    conditions.push(`s.payment_status = $${i++}`);
    params.push(p.payment_status);
  }
  if (p.expired_only) {
    conditions.push(`s.status = 'expired'`);
  }
  if (p.active_only) {
    conditions.push(`s.status = 'active'`);
  }
  if (p.speed) {
    conditions.push(
      `(coalesce(s.speed_down_override, p.speed_down) = $${i} OR coalesce(s.speed_up_override, p.speed_up) = $${i})`
    );
    params.push(p.speed);
    i++;
  }
  if (p.low_data_gb !== undefined) {
    conditions.push(`s.data_remaining_gb IS NOT NULL AND s.data_remaining_gb < $${i++}`);
    params.push(p.low_data_gb);
  }
  if (p.negative_balance) {
    conditions.push(
      `(SELECT COALESCE(SUM(ft.amount), 0) FROM financial_transactions ft WHERE ft.subscriber_id = s.id) < 0`
    );
  }
  if (p.city?.trim()) {
    conditions.push(`(c.city ILIKE $${i++})`);
    params.push(`%${p.city.trim()}%`);
  }

  const scope = subscriberCityScope("s", req, i);
  conditions.push(`(${scope.sql})`);
  params.push(...scope.params);

  return { conditions, params };
}
