import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { anyStaff } from "../middleware/rbac.js";
import { getSchemaFlagsSync } from "../db/schemaFlags.js";
import { query } from "../db/pool.js";
import { getUserUsageGb } from "../services/radiusAccounting.js";

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/users/:username/usage — same as GET /api/accounting/usage/:username (Radius Manager style)
 */
router.get("/:username/usage", anyStaff, async (req, res) => {
  const username = req.params.username;
  if (req.user?.role === "manager" && req.user.scope_city?.trim() && getSchemaFlagsSync().customer_city) {
    const { rows } = await query(
      `SELECT 1 FROM subscribers s
       JOIN customer_profiles c ON c.id = s.customer_profile_id
       WHERE s.username = $1 AND lower(trim(coalesce(c.city,''))) = lower(trim($2))`,
      [username, req.user.scope_city]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
  }
  const u = await getUserUsageGb(username);
  res.json({ usage: u.total_gb.toFixed(2), input_gb: u.input_gb.toFixed(4), output_gb: u.output_gb.toFixed(4) });
});

export default router;
