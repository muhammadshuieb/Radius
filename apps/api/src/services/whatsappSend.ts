import { config } from "../config.js";
import { isWahaConfigured, wahaFetch } from "./waha.js";

export async function sendWhatsAppText(chatId: string, text: string): Promise<{ ok: boolean; detail?: string }> {
  if (!isWahaConfigured()) return { ok: false, detail: "WAHA not configured" };
  const body = JSON.stringify({
    session: config.wahaSessionName,
    chatId,
    text,
  });
  const r = await wahaFetch("/api/sendText", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const responseText = await r.text();
  if (!r.ok) {
    return { ok: false, detail: responseText.slice(0, 500) };
  }
  if (responseText.trim()) {
    try {
      const j = JSON.parse(responseText) as { error?: unknown };
      if (j && typeof j === "object" && j.error != null) {
        return { ok: false, detail: String(j.error).slice(0, 500) };
      }
    } catch {
      /* non-JSON success body is common */
    }
  }
  return { ok: true };
}
