import { statfs } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { anyStaff } from "../middleware/rbac.js";

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/system/host — CPU/RAM/disk/uptime for the machine running this API (often the RADIUS stack container/host).
 */
router.get("/host", anyStaff, async (_req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ramPercent = totalMem > 0 ? ((totalMem - freeMem) / totalMem) * 100 : 0;

  const cpus = Math.max(1, os.cpus().length);
  const la = os.loadavg();
  /** Load average vs cores — rough “pressure” (0–100); on Windows loadavg is often [0,0,0]. */
  let cpuPercent = 0;
  if (process.platform !== "win32") {
    cpuPercent = Math.min(100, (la[0] / cpus) * 100);
  } else {
    cpuPercent = Math.min(100, la[0] * 20);
  }

  let diskPercent: number | null = null;
  try {
    const diskPath = process.platform === "win32" ? path.join(process.env.SystemDrive || "C:", "\\") : "/";
    const s = await statfs(diskPath);
    const blocks = Number(s.blocks);
    const bsize = Number(s.bsize);
    const bfree = Number(s.bfree);
    const total = blocks * bsize;
    const free = bfree * bsize;
    if (total > 0) diskPercent = ((total - free) / total) * 100;
  } catch {
    diskPercent = null;
  }

  res.json({
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    uptime_sec: Math.floor(os.uptime()),
    cpu_percent: Math.round(cpuPercent * 10) / 10,
    ram_percent: Math.round(ramPercent * 10) / 10,
    disk_percent: diskPercent != null ? Math.round(diskPercent * 10) / 10 : null,
    load_avg: la,
    note:
      "Metrics describe the host/container running this Node API (often the same machine as the RADIUS management stack). CPU is derived from load average on Linux.",
  });
});

export default router;
