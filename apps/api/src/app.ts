import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";

import auth from "./routes/auth.js";
import packages from "./routes/packages.js";
import subscribers from "./routes/subscribers.js";
import dashboard from "./routes/dashboard.js";
import invoices from "./routes/invoices.js";
import payments from "./routes/payments.js";
import expenses from "./routes/expenses.js";
import products from "./routes/products.js";
import sales from "./routes/sales.js";
import mikrotik from "./routes/mikrotik.js";
import accounting from "./routes/accounting.js";
import usersAlias from "./routes/usersAlias.js";
import staff from "./routes/staff.js";
import system from "./routes/system.js";
import finance from "./routes/finance.js";
import notifications from "./routes/notifications.js";
import whatsapp from "./routes/whatsapp.js";
import audit from "./routes/audit.js";
import maintenance, { handleDriveOAuthCallback } from "./routes/maintenance.js";
import nas from "./routes/nas.js";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "2mb" }));

  /**
   * @openapi-style (inline)
   * GET /api/health — liveness
   */
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "prince-radius-saas-api" });
  });

  app.get("/api/maintenance/drive/callback", (req, res) => {
    void handleDriveOAuthCallback(req, res);
  });

  app.use("/api/auth", auth);
  app.use("/api/staff", staff);
  app.use("/api/packages", packages);
  app.use("/api/subscribers", subscribers);
  app.use("/api/dashboard", dashboard);
  app.use("/api/invoices", invoices);
  app.use("/api/payments", payments);
  app.use("/api/expenses", expenses);
  app.use("/api/products", products);
  app.use("/api/sales", sales);
  app.use("/api/mikrotik", mikrotik);
  app.use("/api/nas", nas);
  app.use("/api/accounting", accounting);
  app.use("/api/users", usersAlias);
  app.use("/api/system", system);
  app.use("/api/finance", finance);
  app.use("/api/notifications", notifications);
  app.use("/api/whatsapp", whatsapp);
  app.use("/api/audit", audit);
  app.use("/api/maintenance", maintenance);

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
