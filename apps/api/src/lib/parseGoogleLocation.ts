/**
 * Parse "lat,lng", a Google Maps URL (?q= / &ll=), or "@lat,lng" from a maps path.
 */
export function parseGoogleLocation(raw: string): { lat: number; lng: number } | null {
  const s = raw.trim();
  if (!s) return null;
  let part = s;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const q = u.searchParams.get("q") ?? u.searchParams.get("query");
      if (q) part = decodeURIComponent(q.replace(/\+/g, " "));
      else {
        const ll = u.searchParams.get("ll");
        if (ll) part = decodeURIComponent(ll);
        else {
          const at = u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
          if (at) part = `${at[1]},${at[2]}`;
        }
      }
    } catch {
      return null;
    }
  }
  const nums = part
    .split(/[,،\s]+/)
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isFinite(n));
  if (nums.length < 2) return null;
  const lat = nums[0];
  const lng = nums[1];
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}
