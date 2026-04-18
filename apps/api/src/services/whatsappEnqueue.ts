import { query } from "../db/pool.js";
import { interpolateTemplate } from "../lib/whatsappTemplate.js";
import { normalizePhoneToChatId } from "../lib/whatsappPhone.js";
import { whatsappQueue } from "../queue/whatsappQueue.js";
import { getWhatsAppSettings } from "./whatsappSettingsDb.js";
import { isWahaConfigured } from "./waha.js";

type SubRow = {
  username: string;
  display_name: string | null;
  phone: string | null;
  expires_at: string | null;
  balance: string;
};

async function loadSubRow(id: string): Promise<SubRow | null> {
  const { rows } = await query<SubRow>(
    `SELECT s.username, c.display_name, c.phone, s.expires_at::text,
            (SELECT COALESCE(SUM(ft.amount),0)::text FROM financial_transactions ft WHERE ft.subscriber_id = s.id) AS balance
     FROM subscribers s
     LEFT JOIN customer_profiles c ON c.id = s.customer_profile_id
     WHERE s.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

function daysLeft(expiresAt: string | null): string {
  if (!expiresAt) return "—";
  const e = new Date(expiresAt);
  const d = Math.ceil((e.getTime() - Date.now()) / 86400000);
  return String(Math.max(0, d));
}

export async function enqueueWhatsAppRenewal(subscriberId: string): Promise<void> {
  if (!isWahaConfigured()) return;
  const settings = await getWhatsAppSettings();
  if (!settings.notify_renewal) return;
  const row = await loadSubRow(subscriberId);
  if (!row) return;
  const chatId = normalizePhoneToChatId(row.phone);
  if (!chatId) return;
  const text = interpolateTemplate(settings.template_renewal, {
    company: settings.company_name,
    username: row.username,
    full_name: row.display_name ?? row.username,
    expires_at: row.expires_at ?? "—",
    days_left: daysLeft(row.expires_at),
    balance: row.balance,
    phone: row.phone ?? "",
  });
  await whatsappQueue.add("send_one", { chatId, text }, { removeOnComplete: 200, removeOnFail: 50 });
}

export async function enqueueWhatsAppNewUser(subscriberId: string): Promise<void> {
  if (!isWahaConfigured()) return;
  const settings = await getWhatsAppSettings();
  if (!settings.notify_new_user) return;
  const row = await loadSubRow(subscriberId);
  if (!row) return;
  const chatId = normalizePhoneToChatId(row.phone);
  if (!chatId) return;
  const text = interpolateTemplate(settings.template_new_user, {
    company: settings.company_name,
    username: row.username,
    full_name: row.display_name ?? row.username,
    expires_at: row.expires_at ?? "—",
    days_left: daysLeft(row.expires_at),
    balance: row.balance,
    phone: row.phone ?? "",
  });
  await whatsappQueue.add("send_one", { chatId, text }, { removeOnComplete: 200, removeOnFail: 50 });
}
