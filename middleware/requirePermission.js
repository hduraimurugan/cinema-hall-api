import db from '../db.js';
import logger from '../utils/logger.js';

const permissionCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(adminId, orgId) {
  const key = `${adminId}:${orgId}`;
  const entry = permissionCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    permissionCache.delete(key);
    return null;
  }
  return entry.permissions;
}

function setCache(adminId, orgId, permissions) {
  const key = `${adminId}:${orgId}`;
  permissionCache.set(key, { permissions, ts: Date.now() });
  if (permissionCache.size > 500) {
    const firstKey = permissionCache.keys().next().value;
    permissionCache.delete(firstKey);
  }
}

export function clearPermissionCache(adminId, orgId) {
  const key = `${adminId}:${orgId}`;
  permissionCache.delete(key);
}

export async function loadAdminPermissions(adminId, orgId) {
  const cached = getCached(adminId, orgId);
  if (cached) return cached;

  const { rows } = await db.query(
    `SELECT p.key
     FROM organization_members om
     JOIN roles r ON r.id = om.role_id
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE om.admin_id = $1 AND om.org_id = $2 AND om.status = 'active'`,
    [adminId, orgId]
  );

  const permissions = new Set(rows.map(r => r.key));
  setCache(adminId, orgId, permissions);
  return permissions;
}

export async function resolveOrgId(adminId) {
  // Check owner first
  const { rows } = await db.query(
    `SELECT id FROM organizations WHERE owner_id = $1 AND is_active = TRUE LIMIT 1`,
    [adminId]
  );
  if (rows.length > 0) return rows[0].id;

  // Check organization_members (staff / non-owner members)
  const memberResult = await db.query(
    `SELECT org_id FROM organization_members WHERE admin_id = $1 AND status = 'active' LIMIT 1`,
    [adminId]
  );
  if (memberResult.rows.length > 0) return memberResult.rows[0].org_id;

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

function isMutationPerm(key) {
  if (!key || typeof key !== 'string') return false;
  const parts = key.split('.');
  if (parts.length < 2) return false;
  const action = parts[1];
  return ['create', 'update', 'delete', 'manage', 'cancel', 'settle', 'revoke', 'invite'].includes(action);
}

export function requirePermission(permissionKey) {
  return async (req, res, next) => {
    try {
      if (req.admin.role === 'superAdmin' || req.admin.role === 'admin') {
        return next();
      }

      const orgId = req.admin.orgId || await resolveOrgId(req.admin.id);
      if (!orgId) {
        return res.status(403).json({ error: 'No organization found' });
      }

      const permissions = await loadAdminPermissions(req.admin.id, orgId);

      if (!permissions.has(permissionKey)) {
        return res.status(403).json({ error: 'Permission denied', required: permissionKey });
      }

      if (req.currentHallId) {
        const { rows } = await db.query(
          `SELECT scope FROM hall_assignments ha
           JOIN organization_members om ON om.id = ha.org_member_id
           WHERE om.admin_id = $1 AND ha.hall_id = $2 AND om.status = 'active'`,
          [req.admin.id, req.currentHallId]
        );

        if (rows.length === 0) {
          const hallOwner = await db.query(
            `SELECT id FROM cinema_hall WHERE id = $1 AND admin_id = $2`,
            [req.currentHallId, req.admin.id]
          );
          if (hallOwner.rows.length === 0) {
            return res.status(403).json({ error: 'Hall access denied' });
          }
          req.hallScope = 'full';
          return next();
        }

        const scope = rows[0].scope;
        req.hallScope = scope;

        if (scope === 'read_only' && isMutationPerm(permissionKey)) {
          return res.status(403).json({ error: 'Read-only access', required: permissionKey });
        }
      }

      next();
    } catch (err) {
      logger.error('requirePermission error:', { message: err.message });
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
}
