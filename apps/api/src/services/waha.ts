import { config } from "../config.js";

export function isWahaConfigured(): boolean {
  return config.wahaBaseUrl.length > 0;
}

function buildHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  if (config.wahaApiKey) h.set("X-Api-Key", config.wahaApiKey);
  return h;
}

export async function wahaFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!isWahaConfigured()) throw new Error("WAHA not configured (WAHA_BASE_URL)");
  const url = `${config.wahaBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, { ...init, headers: buildHeaders(init.headers) });
}

export async function wahaJson<T>(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data?: T; text?: string }> {
  const r = await wahaFetch(path, init);
  const text = await r.text();
  if (!r.ok) return { ok: false, status: r.status, text };
  try {
    return { ok: true, status: r.status, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, status: r.status, text };
  }
}
