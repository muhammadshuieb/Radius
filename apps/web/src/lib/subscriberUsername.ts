/** Mirrors API `USERNAME_RE` in `apps/api/src/routes/subscribers.ts`. */
export const SUBSCRIBER_USERNAME_RE = /^[\p{L}\p{N}._@+-]{2,64}$/u;

export function isValidSubscriberUsername(trimmed: string): boolean {
  return trimmed.length >= 2 && SUBSCRIBER_USERNAME_RE.test(trimmed);
}
