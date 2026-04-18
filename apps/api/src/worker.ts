import { Worker } from "bullmq";
import { ensureAppSchema } from "./db/ensureAppSchema.js";
import { ensureDmaRadiusSchema } from "./db/ensureDmaRadiusSchema.js";
import { ensureDefaultStaffUser } from "./db/ensureStaffSeed.js";
import { ensureRadiusAccountingSchema } from "./db/ensureRadiusSchema.js";
import { query } from "./db/pool.js";
import { redisConnection } from "./queue/connection.js";
import { BILLING_QUEUE } from "./queue/billingQueue.js";
import { whatsappQueue, WHATSAPP_QUEUE } from "./queue/whatsappQueue.js";
import {
  aggregateUserUsageDailyYesterday,
  radiusAccountingCycle,
} from "./services/radiusAccounting.js";
import { runNasHealthCheckAll } from "./services/nas.service.js";
import { runExpiryWarningIfDue } from "./services/whatsappExpiryJob.js";
import { runWhatsAppBulkSend } from "./services/whatsappBulkSendRunner.js";
import { sendWhatsAppText } from "./services/whatsappSend.js";
import { broadcast } from "./ws/broadcast.js";
import { purgeStaleOauthStates, runBackupJob, runRetentionCleanup } from "./services/backupService.js";

async function autoExpireSubscribers() {
  await query(
    `UPDATE subscribers
     SET status = 'expired', updated_at = now()
     WHERE status = 'active'
       AND expires_at IS NOT NULL
       AND expires_at < now()`
  );
  broadcast("subscribers.auto_expired", { at: new Date().toISOString() });
}

async function generateRecurringInvoices() {
  broadcast("invoices.recurring_tick", { at: new Date().toISOString() });
}

async function main() {
  await ensureRadiusAccountingSchema();
  await ensureDmaRadiusSchema();
  await ensureAppSchema();
  await ensureDefaultStaffUser();

  const worker = new Worker(
    BILLING_QUEUE,
    async (job) => {
      if (job.name === "auto_expire_subscribers") await autoExpireSubscribers();
      if (job.name === "generate_recurring_invoices") await generateRecurringInvoices();
      if (job.name === "radius_accounting_cycle") {
        const r = await radiusAccountingCycle();
        if (r.enforce.disabled_usernames.length) {
          broadcast("radius.enforced", { usernames: r.enforce.disabled_usernames });
        }
      }
      if (job.name === "aggregate_user_usage_daily") await aggregateUserUsageDailyYesterday();
      if (job.name === "nas_health_check") await runNasHealthCheckAll();
      if (job.name === "daily_pg_backup") {
        const source = (job.data as { source?: string })?.source === "manual" ? "manual" : "scheduled";
        await runBackupJob(source);
      }
      if (job.name === "backup_retention_cleanup") {
        await runRetentionCleanup();
        await purgeStaleOauthStates();
      }
    },
    { connection: redisConnection }
  );

  worker.on("failed", (job, err) => {
    console.error("[worker] job failed", job?.name, err);
  });

  const waWorker = new Worker(
    WHATSAPP_QUEUE,
    async (job) => {
      if (job.name === "send_one") {
        const { chatId, text, logId } = job.data as { chatId: string; text: string; logId?: string };
        const r = await sendWhatsAppText(chatId, text);
        if (logId) {
          await query(
            `UPDATE whatsapp_delivery_log
             SET status = $1, error = $2, sent_at = CASE WHEN $3 THEN now() ELSE NULL END
             WHERE id = $4::uuid`,
            [r.ok ? "sent" : "failed", r.ok ? null : (r.detail ?? "failed"), r.ok, logId]
          );
        }
        if (!r.ok) throw new Error(r.detail ?? "WhatsApp send failed");
        return;
      }
      if (job.name === "bulk_send") {
        const { items, delayMs } = job.data as { items: Parameters<typeof runWhatsAppBulkSend>[0]; delayMs: number };
        await runWhatsAppBulkSend(items, delayMs);
        return;
      }
      if (job.name === "expiry_tick") {
        await runExpiryWarningIfDue();
        return;
      }
    },
    { connection: redisConnection }
  );

  waWorker.on("failed", (job, err) => {
    console.error("[worker] whatsapp job failed", job?.name, err);
  });

  try {
    await whatsappQueue.add("expiry_tick", {}, { repeat: { every: 60 * 1000 }, jobId: "repeat-wa-expiry-tick" });
  } catch (e) {
    console.warn("[worker] Could not register WhatsApp tick (Redis down?)", e);
  }

  console.log("[worker] billing queue worker started");
  console.log("[worker] whatsapp queue worker started");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
