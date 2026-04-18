/**
 * Subscription expiry aligned to 12:00:00 local wall-clock (server timezone).
 */

/** Next calendar instant at 12:00:00 (noon) strictly after `from` if today's noon already passed, else today at noon. */
export function nextNoon(from: Date = new Date()): Date {
  const d = new Date(from.getTime());
  d.setHours(12, 0, 0, 0);
  if (d.getTime() <= from.getTime()) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/** Today at 12:00:00 local (may be in the past). */
export function todayAtNoon(from: Date = new Date()): Date {
  const d = new Date(from.getTime());
  d.setHours(12, 0, 0, 0);
  return d;
}

/** Add calendar days keeping wall-clock time (noon stays noon). */
export function addDaysAtNoon(baseNoon: Date, days: number): Date {
  const d = new Date(baseNoon.getTime());
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return d;
}

/** New subscriber: next noon + package duration (days). */
export function expiresAfterPackageDuration(durationDays: number, from: Date = new Date()): Date {
  const anchor = nextNoon(from);
  return addDaysAtNoon(anchor, durationDays);
}

/**
 * Pay & renew — 30-day extension aligned to noon.
 * - Expired (or no expiry): anchor = next noon from now, then +30 days.
 * - Active: anchor = current expires_at normalized to noon same calendar day, then +30 days.
 */
export function renewExpiresAt30Days(
  currentExpires: Date | null,
  status: string,
  now: Date = new Date()
): { expiresAt: Date } {
  const expired = !currentExpires || currentExpires.getTime() < now.getTime() || status === "expired";

  if (expired) {
    const anchor = nextNoon(now);
    return { expiresAt: addDaysAtNoon(anchor, 30) };
  }

  const e = new Date(currentExpires!);
  e.setHours(12, 0, 0, 0);
  return { expiresAt: addDaysAtNoon(e, 30) };
}

/** Normalize any date to noon same calendar day (for consistent storage). */
export function normalizeToNoon(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(12, 0, 0, 0);
  return x;
}

/** Extend by N days from next noon if expired, else from current expiry (noon-aligned). */
export function extendFromNowOrCurrent(
  currentExpires: Date | null,
  status: string,
  addDays: number,
  now: Date = new Date()
): { expiresAt: Date } {
  const expired = !currentExpires || currentExpires.getTime() < now.getTime() || status === "expired";
  if (expired) {
    const anchor = nextNoon(now);
    return { expiresAt: addDaysAtNoon(anchor, addDays) };
  }
  const e = normalizeToNoon(new Date(currentExpires!));
  return { expiresAt: addDaysAtNoon(e, addDays) };
}
