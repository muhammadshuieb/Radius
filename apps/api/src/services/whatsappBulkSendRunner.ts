import { query } from "../db/pool.js";
import { sendWhatsAppText } from "./whatsappSend.js";

export type BulkSendItem = {
  chatId: string;
  text: string;
  subscriberId?: string;
  kind?: "expiry";
  sentOn?: string;
  logId?: string;
};

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * Sends WhatsApp messages sequentially with delay. Used by the worker queue and
 * by the broadcast API (inline) so broadcasts complete even when no worker process runs.
 */
export async function runWhatsAppBulkSend(items: BulkSendItem[], delayMs: number): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    if (i > 0) await sleep(delayMs);
    const it = items[i];
    if (it.logId) {
      const { rows } = await query<{ id: string }>(
        `SELECT id FROM whatsapp_delivery_log WHERE id = $1::uuid AND status = 'queued'`,
        [it.logId]
      );
      if (!rows[0]) {
        continue;
      }
    }
    try {
      const r = await sendWhatsAppText(it.chatId, it.text);
      if (it.logId) {
        await query(
          `UPDATE whatsapp_delivery_log
           SET status = $1, error = $2, sent_at = CASE WHEN $3 THEN now() ELSE NULL END
           WHERE id = $4::uuid`,
          [r.ok ? "sent" : "failed", r.ok ? null : (r.detail ?? "failed"), r.ok, it.logId]
        );
      }
      if (!r.ok) {
        console.warn("[whatsappBulkSend] item failed", it.chatId, r.detail);
        continue;
      }
      if (it.kind === "expiry" && it.subscriberId && it.sentOn) {
        try {
          await query(
            `INSERT INTO whatsapp_sent_log (subscriber_id, kind, sent_on) VALUES ($1, 'expiry', $2::date) ON CONFLICT DO NOTHING`,
            [it.subscriberId, it.sentOn]
          );
        } catch (sentLogErr) {
          console.error("[whatsappBulkSend] whatsapp_sent_log insert failed (send already ok)", sentLogErr);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[whatsappBulkSend] item threw", it.chatId, e);
      if (it.logId) {
        try {
          await query(
            `UPDATE whatsapp_delivery_log SET status = 'failed', error = $1, sent_at = NULL WHERE id = $2::uuid`,
            [msg.slice(0, 500), it.logId]
          );
        } catch (dbErr) {
          console.error("[whatsappBulkSend] failed to update log row", dbErr);
        }
      }
    }
  }
}
