import { redisConnection } from "../queue/connection.js";
import { query } from "../db/pool.js";
import { interpolateTemplate } from "../lib/whatsappTemplate.js";
import { normalizePhoneToChatId } from "../lib/whatsappPhone.js";
import { calendarDateInTz, getNowPartsInTz } from "../lib/whatsappTime.js";
import { whatsappQueue } from "../queue/whatsappQueue.js";
import { getWhatsAppSettings } from "./whatsappSettingsDb.js";
import { isWahaConfigured } from "./waha.js";

/**
 * Called once per minute from worker. Sends expiry warnings at configured local time (once per day).
 */
export async function runExpiryWarningIfDue(): Promise<void> {
  if (!isWahaConfigured()) return;
  const settings = await getWhatsAppSettings();
  if (!settings.notify_expiry) return;

  const { hour, minute } = getNowPartsInTz(settings.timezone);
  if (hour !== settings.send_hour || minute !== settings.send_minute) return;

  const dateKey = calendarDateInTz(settings.timezone);
  const claimKey = `wa:expiry_claim:${dateKey}`;
  const claimed = await redisConnection.set(claimKey, "1", "EX", 86400, "NX");
  if (claimed !== "OK") return;

  type Row = {
    id: string;
    username: string;
    expires_at: string | null;
    phone: string | null;
    display_name: string | null;
    balance: string;
  };

  try {
    const { rows } = await query<Row>(
      `SELECT s.id, s.username, s.expires_at::text, c.phone, c.display_name,
              (SELECT COALESCE(SUM(ft.amount),0)::text FROM financial_transactions ft WHERE ft.subscriber_id = s.id) AS balance
       FROM subscribers s
       LEFT JOIN customer_profiles c ON c.id = s.customer_profile_id
       WHERE s.status = 'active'
         AND s.expires_at IS NOT NULL
         AND s.expires_at > now()
         AND s.expires_at <= now() + ($1::int * interval '1 day')
         AND NOT EXISTS (
           SELECT 1 FROM whatsapp_sent_log w
           WHERE w.subscriber_id = s.id AND w.kind = 'expiry' AND w.sent_on = $2::date
         )`,
      [settings.expiry_days_before, dateKey]
    );

    const items: { subscriberId: string; chatId: string; text: string }[] = [];
    for (const r of rows) {
      const chatId = normalizePhoneToChatId(r.phone);
      if (!chatId) continue;
      const days_left = r.expires_at
        ? String(Math.max(0, Math.ceil((new Date(r.expires_at).getTime() - Date.now()) / 86400000)))
        : "0";
      const text = interpolateTemplate(settings.template_expiry, {
        company: settings.company_name,
        username: r.username,
        full_name: r.display_name ?? r.username,
        expires_at: r.expires_at ?? "—",
        days_left,
        balance: r.balance,
        phone: r.phone ?? "",
      });
      items.push({ subscriberId: r.id, chatId, text });
    }

    if (!items.length) {
      await redisConnection.del(claimKey);
      return;
    }

    await whatsappQueue.add(
      "bulk_send",
      {
        items: items.map((i) => ({
          chatId: i.chatId,
          text: i.text,
          subscriberId: i.subscriberId,
          kind: "expiry" as const,
          sentOn: dateKey,
        })),
        delayMs: settings.delay_between_ms,
      },
      { removeOnComplete: 50, removeOnFail: 20 }
    );
  } catch (e) {
    await redisConnection.del(claimKey);
    throw e;
  }
}
