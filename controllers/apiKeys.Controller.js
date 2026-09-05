import db from '../db.js';
import logger from '../utils/logger.js';
import { recordAuditLog } from '../utils/auditLog.js';
import { generateApiKey } from '../utils/apiKeyAuth.js';
import { loadAdminPermissions, resolveOrgId } from '../middleware/requirePermission.js';

// GET /api/api-keys — list my own keys. Never returns the secret itself.
export const listApiKeys = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, prefix, last_used_at, expires_at, created_at
       FROM admin_api_keys
       WHERE admin_id = $1 AND revoked_at IS NULL
       ORDER BY created_at DESC`,
      [req.admin.id]
    );
    res.status(200).json({ keys: rows });
  } catch (err) {
    logger.error('listApiKeys error:', { message: err.message });
    res.status(500).json({ message: 'Failed to fetch API keys' });
  }
};

// POST /api/api-keys — { name, expires_in_days? }
// Self-service: no special permission required, same posture as changing
// your own password. The raw key is returned exactly once.
export const createApiKey = async (req, res) => {
  if (req.viaApiKey) {
    return res.status(403).json({ message: 'An API key cannot be used to create another API key' });
  }

  const { name, expires_in_days } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: 'name is required' });
  }
  const expiresInDays = expires_in_days != null ? Number(expires_in_days) : null;
  if (expiresInDays != null && (!Number.isFinite(expiresInDays) || expiresInDays <= 0)) {
    return res.status(400).json({ message: 'expires_in_days must be a positive number' });
  }

  try {
    const orgId = req.admin.orgId || await resolveOrgId(req.admin.id);
    const { raw, hash, prefix } = generateApiKey();

    const { rows } = await db.query(
      `INSERT INTO admin_api_keys (admin_id, org_id, name, token_hash, prefix, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, prefix, last_used_at, expires_at, created_at`,
      [
        req.admin.id, orgId, name.trim(), hash, prefix,
        expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : null,
      ]
    );

    await recordAuditLog(req, {
      action: 'apiKeys.create',
      resourceType: 'api_key',
      resourceId: rows[0].id,
      resourceLabel: rows[0].name,
    });

    res.status(201).json({ key: rows[0], token: raw });
  } catch (err) {
    logger.error('createApiKey error:', { message: err.message });
    res.status(500).json({ message: 'Failed to create API key' });
  }
};

// DELETE /api/api-keys/:id — always allowed on your own keys; team.manage
// lets an owner/admin revoke a teammate's key too (e.g. after they leave).
export const revokeApiKey = async (req, res) => {
  if (req.viaApiKey) {
    return res.status(403).json({ message: 'An API key cannot be used to revoke API keys' });
  }

  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT id, admin_id, name FROM admin_api_keys WHERE id = $1 AND revoked_at IS NULL`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'API key not found' });
    }
    const key = rows[0];

    const isOwn = key.admin_id === req.admin.id;
    if (!isOwn && req.admin.role !== 'superAdmin') {
      const orgId = req.admin.orgId || await resolveOrgId(req.admin.id);
      const permissions = orgId ? await loadAdminPermissions(req.admin.id, orgId) : new Set();
      if (!permissions.has('team.manage')) {
        return res.status(403).json({ message: 'You can only revoke your own API keys' });
      }
    }

    await db.query(`UPDATE admin_api_keys SET revoked_at = now() WHERE id = $1`, [id]);

    await recordAuditLog(req, {
      action: 'apiKeys.revoke',
      resourceType: 'api_key',
      resourceId: id,
      resourceLabel: key.name,
    });

    res.status(200).json({ message: 'API key revoked' });
  } catch (err) {
    logger.error('revokeApiKey error:', { message: err.message });
    res.status(500).json({ message: 'Failed to revoke API key' });
  }
};

// GET /api/api-keys/context — introspection for machine clients (the
// cinemax MCP server). Returns exactly what a caller needs to build a scope:
// the admin's identity, effective permission keys, and the halls they can
// reach (with per-hall access level), all resolved fresh from the DB.
export const getApiKeyContext = async (req, res) => {
  try {
    const admin = req.admin;
    const isSuperAdmin = admin.role === 'superAdmin';
    const orgId = admin.orgId || await resolveOrgId(admin.id);

    let permissions;
    if (isSuperAdmin) {
      const { rows } = await db.query(`SELECT key FROM permissions`);
      permissions = rows.map(r => r.key);
    } else if (orgId) {
      permissions = Array.from(await loadAdminPermissions(admin.id, orgId));
    } else {
      permissions = [];
    }

    let halls = [];
    if (orgId) {
      const memberRes = await db.query(
        `SELECT om.id AS org_member_id, r.key AS role_key
         FROM organization_members om
         JOIN roles r ON r.id = om.role_id
         WHERE om.admin_id = $1 AND om.org_id = $2 AND om.status = 'active'
         LIMIT 1`,
        [admin.id, orgId]
      );
      if (memberRes.rows.length > 0) {
        const { org_member_id, role_key } = memberRes.rows[0];
        const orgWide = isSuperAdmin || role_key === 'owner' || role_key === 'admin';
        const { rows } = orgWide
          ? await db.query(
              `SELECT id, name, 'full' AS scope FROM cinema_hall WHERE org_id = $1 AND is_active = TRUE ORDER BY name`,
              [orgId]
            )
          : await db.query(
              `SELECT ch.id, ch.name, ha.scope
               FROM cinema_hall ch
               JOIN hall_assignments ha ON ha.hall_id = ch.id
               WHERE ha.org_member_id = $1 AND ch.is_active = TRUE ORDER BY ch.name`,
              [org_member_id]
            );
        halls = rows;
      }
    }

    res.status(200).json({
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role, roleKey: admin.roleKey, orgId },
      permissions,
      halls,
    });
  } catch (err) {
    logger.error('getApiKeyContext error:', { message: err.message });
    res.status(500).json({ message: 'Failed to resolve API key context' });
  }
};
