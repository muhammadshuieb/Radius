import { query } from "../db/pool.js";

export type WhatsAppNotificationSettings = {
  company_name: string;
  template_renewal: string;
  template_new_user: string;
  template_expiry: string;
  template_credit: string;
  template_debt: string;
  expiry_days_before: number;
  send_hour: number;
  send_minute: number;
  timezone: string;
  delay_between_ms: number;
  notify_renewal: boolean;
  notify_new_user: boolean;
  notify_expiry: boolean;
};

const defaults: WhatsAppNotificationSettings = {
  company_name: "Company",
  template_renewal:
    "Hello {username}, your service was renewed. {company}. New expiry: {expires_at}.",
  template_new_user: "Welcome {username} at {company}. Your account is active. Expires: {expires_at}.",
  template_expiry:
    "Reminder {username}: subscription expires on {expires_at} ({days_left} days). — {company}",
  template_credit: "Hello {username}, credit balance: {balance}. — {company}",
  template_debt: "Hello {username}, outstanding balance: {balance}. — {company}",
  expiry_days_before: 7,
  send_hour: 12,
  send_minute: 0,
  timezone: "Asia/Riyadh",
  delay_between_ms: 8000,
  notify_renewal: true,
  notify_new_user: true,
  notify_expiry: true,
};

export async function getWhatsAppSettings(): Promise<WhatsAppNotificationSettings> {
  const { rows } = await query<WhatsAppNotificationSettings>(
    `SELECT company_name, template_renewal, template_new_user, template_expiry, template_credit, template_debt,
            expiry_days_before, send_hour, send_minute, timezone, delay_between_ms,
            notify_renewal, notify_new_user, notify_expiry
     FROM whatsapp_notification_settings WHERE id = 1`
  );
  return rows[0] ?? defaults;
}

export async function saveWhatsAppSettings(p: Partial<WhatsAppNotificationSettings>): Promise<WhatsAppNotificationSettings> {
  const cur = await getWhatsAppSettings();
  const n = { ...cur, ...p };
  await query(
    `UPDATE whatsapp_notification_settings SET
       company_name = $1,
       template_renewal = $2,
       template_new_user = $3,
       template_expiry = $4,
       template_credit = $5,
       template_debt = $6,
       expiry_days_before = $7,
       send_hour = $8,
       send_minute = $9,
       timezone = $10,
       delay_between_ms = $11,
       notify_renewal = $12,
       notify_new_user = $13,
       notify_expiry = $14,
       updated_at = now()
     WHERE id = 1`,
    [
      n.company_name,
      n.template_renewal,
      n.template_new_user,
      n.template_expiry,
      n.template_credit,
      n.template_debt,
      n.expiry_days_before,
      n.send_hour,
      n.send_minute,
      n.timezone,
      n.delay_between_ms,
      n.notify_renewal,
      n.notify_new_user,
      n.notify_expiry,
    ]
  );
  return getWhatsAppSettings();
}
