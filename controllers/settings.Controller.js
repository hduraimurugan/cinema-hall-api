import db from "../db.js";
import logger from '../utils/logger.js';

// ── Helpers ────────────────────────────────────────────────────────

/** Resolve or auto-create the org_id for the currently authenticated admin. */
async function resolveOrgId(adminId) {
  // Try existing
  const { rows } = await db.query(
    `SELECT id FROM organizations WHERE owner_id = $1 AND is_active = TRUE LIMIT 1`,
    [adminId]
  );
  if (rows.length > 0) return rows[0].id;

  // Auto-create org for admin (handles admins created after migration)
  try {
    const admin = await db.query(
      `SELECT id, name, email FROM cinema_admin_user WHERE id = $1`,
      [adminId]
    );
    if (admin.rows.length === 0) return null;

    const a = admin.rows[0];
    const baseName = (a.name || a.email || 'admin').replace(/[^a-zA-Z0-9 ]/g, '');
    const slugBase = baseName.toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-') || 'cinema';
    const uniqueSlug = `${slugBase}-${a.id.toString().slice(0, 8)}`;
    const orgName = baseName + "'s Cinema";

    const org = await db.query(
      `INSERT INTO organizations (name, slug, owner_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET owner_id = EXCLUDED.owner_id
       RETURNING id`,
      [orgName, uniqueSlug, a.id]
    );
    return org.rows[0].id;
  } catch (err) {
    logger.error("Failed to auto-create organization:", { error: err.message, adminId });
    return null;
  }
}

/** Fetch a single settings row by scope + section. */
async function getSectionRow(client, table, idCol, idVal, section) {
  const { rows } = await client.query(
    `SELECT value, schema_version, updated_at FROM ${table} WHERE ${idCol} = $1 AND section = $2`,
    [idVal, section]
  );
  return rows[0] ?? null;
}

// ── Backward-compat: GET /api/settings (public) ────────────────────
export const getSettings = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT key, value FROM settings WHERE key IN ('convenience_fee_per_ticket', 'gst_percentage')`
    );
    const settings = {};
    rows.forEach(({ key, value }) => { settings[key] = parseFloat(value); });
    return res.status(200).json(settings);
  } catch (error) {
    logger.error("❌ Get settings error:", { error });
    return res.status(500).json({ error: "Failed to fetch settings" });
  }
};

// ── GET /api/settings/org ──────────────────────────────────────────
export const getOrgSettings = async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.admin.id);
    if (!orgId) return res.status(404).json({ error: "Organization not found" });

    // Fetch org name
    const orgResult = await db.query(
      `SELECT name, slug, plan, created_at FROM organizations WHERE id = $1`,
      [orgId]
    );
    const org = orgResult.rows[0];

    // Fetch settings sections
    const { rows } = await db.query(
      `SELECT section, value, schema_version, updated_at FROM organization_settings WHERE org_id = $1`,
      [orgId]
    );
    const settings = {};
    rows.forEach(r => { settings[r.section] = r.value; });

    // Always provide org_name from organizations table (source of truth)
    if (!settings.general) settings.general = {};
    if (org.name) {
      settings.general.org_name = org.name;
    }

    return res.status(200).json({ orgId, org: { name: org.name, slug: org.slug, plan: org.plan }, settings });
  } catch (error) {
    logger.error("❌ Get org settings error:", { error });
    return res.status(500).json({ error: "Failed to fetch organization settings" });
  }
};

// ── PATCH /api/settings/org  (super admin only) ────────────────────
export const updateOrgSettings = async (req, res) => {
  const { section, patch } = req.body;
  if (!section || !patch || typeof patch !== 'object') {
    return res.status(400).json({ error: "section (string) and patch (object) are required" });
  }

  const allowedSections = ['general','payment','tickets','security','notifications','branding','integrations','advanced'];
  if (!allowedSections.includes(section)) {
    return res.status(400).json({ error: `Invalid section. Allowed: ${allowedSections.join(', ')}` });
  }

  try {
    const orgId = await resolveOrgId(req.admin.id);
    if (!orgId) return res.status(404).json({ error: "Organization not found" });

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const row = await getSectionRow(client, 'organization_settings', 'org_id', orgId, section);
      const before = row ? row.value : {};

      const merged = row
        ? { ...row.value, ...patch }
        : patch;

      // Sync org_name to organizations table (source of truth)
      if (section === 'general' && patch.org_name) {
        await client.query(
          `UPDATE organizations SET name = $1, updated_at = now() WHERE id = $2`,
          [patch.org_name, orgId]
        );
      }
      // Always strip org_name from settings JSONB — source of truth is organizations.name
      if (section === 'general') {
        delete merged.org_name;
      }

      if (Object.keys(merged).length > 0) {
        await client.query(
          `INSERT INTO organization_settings (org_id, section, value, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (org_id, section) DO UPDATE
             SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [orgId, section, JSON.stringify(merged), req.admin.id]
        );
      }

      await client.query('COMMIT');

      // Return both the section data and updated org name
      const resPayload = { section, value: merged };
      if (section === 'general') {
        const orgResult = await client.query(
          `SELECT name FROM organizations WHERE id = $1`, [orgId]
        );
        resPayload.org = { name: orgResult.rows[0]?.name };
      }
      return res.status(200).json(resPayload);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error("❌ Update org settings error:", { error });
    return res.status(500).json({ error: "Failed to update organization settings" });
  }
};

// ── GET /api/settings/hall/:hallId ─────────────────────────────────
export const getHallSettings = async (req, res) => {
  try {
    const hallId = req.currentHallId || req.params.hallId;
    if (!hallId) return res.status(400).json({ error: "Hall ID is required" });

    const { rows } = await db.query(
      `SELECT section, value, schema_version, updated_at FROM hall_settings WHERE hall_id = $1`,
      [hallId]
    );
    const settings = {};
    rows.forEach(r => { settings[r.section] = r.value; });
    return res.status(200).json({ hallId, settings });
  } catch (error) {
    logger.error("❌ Get hall settings error:", { error });
    return res.status(500).json({ error: "Failed to fetch hall settings" });
  }
};

// ── PATCH /api/settings/hall/:hallId ──────────────────────────────
export const updateHallSettings = async (req, res) => {
  const { section, patch } = req.body;
  if (!section || !patch || typeof patch !== 'object') {
    return res.status(400).json({ error: "section (string) and patch (object) are required" });
  }

  const allowedSections = ['cinema_profile','showtimes','booking','offers'];
  if (!allowedSections.includes(section)) {
    return res.status(400).json({ error: `Invalid section. Allowed: ${allowedSections.join(', ')}` });
  }

  try {
    const hallId = req.currentHallId || req.params.hallId;
    if (!hallId) return res.status(400).json({ error: "Hall ID is required" });

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const row = await getSectionRow(client, 'hall_settings', 'hall_id', hallId, section);
      const merged = row ? { ...row.value, ...patch } : patch;

      await client.query(
        `INSERT INTO hall_settings (hall_id, section, value, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (hall_id, section) DO UPDATE
           SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [hallId, section, JSON.stringify(merged), req.admin.id]
      );

      await client.query('COMMIT');
      return res.status(200).json({ section, value: merged });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error("❌ Update hall settings error:", { error });
    return res.status(500).json({ error: "Failed to update hall settings" });
  }
};

// ── GET /api/settings/user ─────────────────────────────────────────
export const getUserSettings = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT section, value, updated_at FROM user_settings WHERE admin_id = $1`,
      [req.admin.id]
    );
    const settings = {};
    rows.forEach(r => { settings[r.section] = r.value; });
    return res.status(200).json({ settings });
  } catch (error) {
    logger.error("❌ Get user settings error:", { error });
    return res.status(500).json({ error: "Failed to fetch user settings" });
  }
};

// ── PATCH /api/settings/user ───────────────────────────────────────
export const updateUserSettings = async (req, res) => {
  const { section, patch } = req.body;
  if (!section || !patch || typeof patch !== 'object') {
    return res.status(400).json({ error: "section (string) and patch (object) are required" });
  }

  const allowedSections = ['notifications','analytics','appearance'];
  if (!allowedSections.includes(section)) {
    return res.status(400).json({ error: `Invalid section. Allowed: ${allowedSections.join(', ')}` });
  }

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const row = await getSectionRow(client, 'user_settings', 'admin_id', req.admin.id, section);
      const merged = row ? { ...row.value, ...patch } : patch;

      await client.query(
        `INSERT INTO user_settings (admin_id, section, value, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (admin_id, section) DO UPDATE
           SET value = EXCLUDED.value, updated_at = now()`,
        [req.admin.id, section, JSON.stringify(merged)]
      );

      await client.query('COMMIT');
      return res.status(200).json({ section, value: merged });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error("❌ Update user settings error:", { error });
    return res.status(500).json({ error: "Failed to update user settings" });
  }
};

// ── Legacy PUT /api/settings (super admin only) ────────────────────
// Kept for backward compat — redirects to updateOrgSettings with section='payment'
export const updateSettings = async (req, res) => {
  const { convenience_fee_per_ticket, gst_percentage } = req.body;

  const patch = {};
  if (convenience_fee_per_ticket !== undefined) {
    const val = parseFloat(convenience_fee_per_ticket);
    if (isNaN(val) || val < 0) return res.status(400).json({ error: "Invalid convenience_fee_per_ticket" });
    patch.convenience_fee = { model: 'per_ticket', amount: val };
  }
  if (gst_percentage !== undefined) {
    const val = parseFloat(gst_percentage);
    if (isNaN(val) || val < 0 || val > 100) return res.status(400).json({ error: "Invalid gst_percentage" });
    patch.gst_percentage = val;
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  // Delegate to org settings with section='payment'
  req.body = { section: 'payment', patch };
  return updateOrgSettings(req, res);
};
