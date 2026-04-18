const raw = import.meta.env.VITE_API_URL as string | undefined;
/** Prefer same-origin `/api` in dev (Vite proxy); absolute URL when set. */
export const API_BASE = (raw && raw.length > 0 ? raw.replace(/\/$/, "") : "") || "";

/**
 * WebSocket URL for API paths (e.g. `/ws`). When `VITE_API_URL` is set (Docker/production),
 * must use the API host — `serve` does not upgrade WebSockets and would return HTML.
 */
export function wsUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  if (API_BASE) {
    try {
      const base = API_BASE.startsWith("http") ? API_BASE : `http://${API_BASE}`;
      const u = new URL(base);
      const scheme = u.protocol === "https:" ? "wss:" : "ws:";
      return `${scheme}//${u.host}${p}`;
    } catch {
      /* fall through */
    }
  }
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${p}`;
}

export function getToken() {
  return localStorage.getItem("token");
}

function parseJsonBody(text: string): unknown {
  const t = text.trim();
  if (!t) return undefined;
  const lower = t.slice(0, 16).toLowerCase();
  if (lower.startsWith("<!doctype") || lower.startsWith("<html") || t.startsWith("<")) {
    throw new Error(
      "API returned HTML instead of JSON. If you use a production build (serve/Docker web image), set VITE_API_URL to your API base URL (e.g. http://localhost:4000) and rebuild. In dev, ensure the API is running and Vite proxies /api to port 4000."
    );
  }
  return JSON.parse(t);
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = parseJsonBody(text) as { error?: unknown };
      if (j && typeof j === "object" && typeof j.error === "string") msg = j.error;
      else if (j && typeof j === "object" && j.error) msg = JSON.stringify(j.error);
    } catch (e) {
      if (e instanceof Error && e.message.includes("HTML")) throw e;
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return parseJsonBody(text) as T;
}

/** GET binary (e.g. WhatsApp QR) with Bearer auth — no JSON Content-Type on request */
export async function apiFetchBlob(path: string): Promise<Blob> {
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: unknown };
      if (typeof j.error === "string") msg = j.error;
      else if (j.error) msg = JSON.stringify(j.error);
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.blob();
}

/** POST multipart/form-data (e.g. restore upload) — do not set Content-Type (browser sets boundary). */
export async function apiFetchMultipart<T>(path: string, form: FormData): Promise<T> {
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", body: form, headers });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: unknown };
      if (typeof j.error === "string") msg = j.error;
      else if (j.error) msg = JSON.stringify(j.error);
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
