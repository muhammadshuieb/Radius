import { config } from "../config.js";
import { isWahaConfigured, wahaFetch } from "./waha.js";

/** WAHA REST path for a session by name */
export function wahaSessionPath(name: string): string {
  return `/api/sessions/${encodeURIComponent(name)}`;
}

export type WahaEnsureResult =
  | { ok: true; created: boolean }
  | { ok: false; error: string; detail?: string; statusCode?: number };

/**
 * Create session if missing, start if STOPPED — same logic as POST /api/whatsapp/session/ensure.
 * Used on API startup so WAHA reconnects after restarts when session files still exist.
 */
export async function ensureWahaSessionReady(): Promise<WahaEnsureResult> {
  if (!isWahaConfigured()) return { ok: false, error: "WAHA not configured", statusCode: 400 };
  const name = config.wahaSessionName;
  try {
    let r = await wahaFetch(wahaSessionPath(name));
    if (r.status === 404) {
      const create = await wahaFetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, start: true }),
      });
      if (!create.ok) {
        const t = await create.text();
        return { ok: false, error: "Failed to create WAHA session", detail: t.slice(0, 400), statusCode: 502 };
      }
      return { ok: true, created: true };
    }
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, error: "WAHA session lookup failed", detail: t.slice(0, 400), statusCode: 502 };
    }
    const existing = (await r.json()) as { status?: string };
    if (existing.status === "STOPPED") {
      const start = await wahaFetch(`${wahaSessionPath(name)}/start`, { method: "POST" });
      if (!start.ok) {
        const t = await start.text();
        return { ok: false, error: "Failed to start WAHA session", detail: t.slice(0, 400), statusCode: 502 };
      }
    }
    return { ok: true, created: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, statusCode: 503 };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Best-effort: WAHA may still be booting when the API starts */
export async function ensureWahaSessionReadyWithRetries(): Promise<void> {
  if (!isWahaConfigured()) return;
  await sleep(2500);
  for (let i = 0; i < 6; i++) {
    const r = await ensureWahaSessionReady();
    if (r.ok) {
      console.log("[waha] Session ensured on API startup (linked session will reconnect if auth data exists).");
      return;
    }
    console.warn(`[waha] Startup ensure attempt ${i + 1}/6:`, r.error, r.detail ?? "");
    await sleep(4000);
  }
  console.warn("[waha] Could not reach WAHA or ensure session after startup — check WAHA_BASE_URL and that waha is running.");
}
