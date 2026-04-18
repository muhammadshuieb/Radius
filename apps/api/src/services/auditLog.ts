import type { Request } from "express";
import { query } from "../db/pool.js";

export async function insertAuditLog(
  req: Request,
  row: {
    action: string;
    entityType: string;
    entityId?: string | null;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  const staffId = req.user?.id;
  if (!staffId) return;
  const fwd = req.headers["x-forwarded-for"];
  const ipRaw = typeof fwd === "string" ? fwd.split(",")[0]?.trim() : null;
  const ip = ipRaw || req.socket.remoteAddress || null;
  try {
    await query(
      `INSERT INTO audit_logs (staff_user_id, action, entity_type, entity_id, details, ip)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [staffId, row.action, row.entityType, row.entityId ?? null, JSON.stringify(row.details ?? {}), ip]
    );
  } catch (e) {
    console.warn("[audit]", e);
  }
}
