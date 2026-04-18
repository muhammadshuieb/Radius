import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { ensureAppSchema } from "./db/ensureAppSchema.js";
import { ensureDmaRadiusSchema } from "./db/ensureDmaRadiusSchema.js";
import { ensureDefaultStaffUser } from "./db/ensureStaffSeed.js";
import { ensureRadiusAccountingSchema } from "./db/ensureRadiusSchema.js";
import { setWss } from "./ws/broadcast.js";
import { billingQueue } from "./queue/billingQueue.js";
import { ensureWahaSessionReadyWithRetries } from "./services/wahaSessionEnsure.js";
import { purgeWhatsAppDeliveryLogOlderThanRetention } from "./services/whatsappDeliveryLogCleanup.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function scheduleDeliveryLogRetentionCleanup() {
  const run = () => {
    void purgeWhatsAppDeliveryLogOlderThanRetention()
      .then((n) => {
        if (n > 0) console.log(`[whatsapp] delivery log retention: deleted ${n} row(s)`);
      })
      .catch((e) => console.error("[whatsapp] delivery log retention failed", e));
  };
  setTimeout(run, 5 * 60 * 1000);
  setInterval(run, DAY_MS);
}

async function main() {
  await ensureRadiusAccountingSchema();
  await ensureDmaRadiusSchema();
  await ensureAppSchema();
  await ensureDefaultStaffUser();
  const app = createApp();
  const httpServer = createServer(app);

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  setWss(wss);
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ event: "hello", payload: { message: "connected" }, t: Date.now() }));
  });

  try {
    await billingQueue.add(
      "auto_expire_subscribers",
      {},
      { repeat: { every: 60 * 60 * 1000 }, jobId: "repeat-auto-expire" }
    );
    await billingQueue.add(
      "generate_recurring_invoices",
      {},
      { repeat: { every: 24 * 60 * 60 * 1000 }, jobId: "repeat-recurring-invoices" }
    );
    await billingQueue.add(
      "radius_accounting_cycle",
      {},
      { repeat: { every: 60 * 1000 }, jobId: "repeat-radius-accounting-60s" }
    );
    await billingQueue.add(
      "nas_health_check",
      {},
      { repeat: { every: 60 * 1000 }, jobId: "repeat-nas-health-60s" }
    );
    await billingQueue.add(
      "aggregate_user_usage_daily",
      {},
      { repeat: { every: 24 * 60 * 60 * 1000 }, jobId: "repeat-usage-daily-rollup" }
    );
    await billingQueue.add(
      "daily_pg_backup",
      { source: "scheduled" },
      { repeat: { pattern: config.backupCronPattern }, jobId: "repeat-daily-pg-backup" }
    );
    await billingQueue.add(
      "backup_retention_cleanup",
      {},
      { repeat: { pattern: config.backupRetentionCronPattern }, jobId: "repeat-backup-retention" }
    );
  } catch (e) {
    console.warn("Could not register repeatable jobs (Redis down?)", e);
  }

  const host = process.env.LISTEN_HOST || "0.0.0.0";
  httpServer.listen(config.port, host, () => {
    console.log(`API listening on ${host}:${config.port} (ws /ws)`);
    void ensureWahaSessionReadyWithRetries();
    scheduleDeliveryLogRetentionCleanup();
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
