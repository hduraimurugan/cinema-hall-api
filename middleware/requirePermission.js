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

/**
 * Drop every cached permission set belonging to an organization.
 *
 * Editing a role changes the effective permissions of every member holding
 * it, but the cache is keyed per-admin, so clearing one entry is not enough —
 * without this a role edit stays invisible for up to CACHE_TTL.
 */
export function clearOrgPermissionCache(orgId) {
  const suffix = `:${orgId}`;
  for (const key of permissionCache.keys()) {
    if (key.endsWith(suffix)) permissionCache.delete(key);
  }
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

/**
 * Resolve the organization an admin acts within.
 *
 * PURE LOOKUP — returns null when there is no membership. It used to create
 * an organization as a side effect, which meant a plain GET could silently
 * provision a tenant. Org creation belongs solely to completeOnboarding.
 *
 * Membership is the single source of truth (owners are members too, via the
 * 'owner' role), so one query covers owners and staff alike.
 *
 * Ordering must stay in step with resolveOrgContext in
 * utils/generateTokenAndSetCookie.js: an org holding halls outranks an empty
 * one, so a hall-less shell org a member happens to own cannot hijack their
 * session; ownership then decides between two real orgs.
 */
export async function resolveOrgId(adminId) {
  const { rows } = await db.query(
    `SELECT om.org_id
     FROM organization_members om
     JOIN organizations o ON o.id = om.org_id
     WHERE om.admin_id = $1 AND om.status = 'active' AND o.is_active = TRUE
     ORDER BY EXISTS (SELECT 1 FROM cinema_hall ch WHERE ch.org_id = o.id) DESC,
              (o.owner_id = $1) DESC,
              om.created_at ASC
     LIMIT 1`,
    [adminId]
  );
  return rows.length > 0 ? rows[0].org_id : null;
}

function isMutationPerm(key) {
  if (!key || typeof key !== 'string') return false;
  const parts = key.split('.');
  if (parts.length < 2) return false;
  const action = parts[1];
  return ['create', 'update', 'delete', 'manage', 'cancel', 'settle', 'revoke', 'invite'].includes(action);
}

/**
 * Reject a token minted before the caller's role was last edited.
 *
 * Access tokens live for a day, so without this a permission change would not
 * take effect until the token expired. Returns an error string, or null if the
 * token is current.
 */
async function checkPermissionsVersion(req, orgId) {
  const tokenVersion = req.admin.permissionsVersion;
  if (tokenVersion === undefined || tokenVersion === null) return null;

  const { rows } = await db.query(
    `SELECT r.permissions_version
     FROM organization_members om
     JOIN roles r ON r.id = om.role_id
     WHERE om.admin_id = $1 AND om.org_id = $2 AND om.status = 'active'`,
    [req.admin.id, orgId]
  );
  if (rows.length === 0) return null;

  return rows[0].permissions_version !== tokenVersion
    ? 'Your access has changed. Please sign in again.'
    : null;
}

export function requirePermission(permissionKey) {
  return async (req, res, next) => {
    try {
      if (req.admin.role === 'superAdmin') {
        return next();
      }

      const orgId = req.orgId || req.admin.orgId || await resolveOrgId(req.admin.id);
      if (!orgId) {
        return res.status(403).json({ error: 'No organization found' });
      }

      const staleMessage = await checkPermissionsVersion(req, orgId);
      if (staleMessage) {
        return res.status(401).json({ code: 'TOKEN_STALE', error: staleMessage });
      }

      const permissions = await loadAdminPermissions(req.admin.id, orgId);

      if (!permissions.has(permissionKey)) {
        return res.status(403).json({ error: 'Permission denied', required: permissionKey });
      }

      // requireActiveHall already resolved the caller's scope for this hall
      // (org-wide roles and the hall's creator get 'full'). Only fall back to
      // a lookup on legacy routes that set currentHallId without it.
      if (req.currentHallId) {
        let scope = req.hallScope;

        if (scope === undefined) {
          const { rows } = await db.query(
            `SELECT ha.scope FROM hall_assignments ha
             JOIN organization_members om ON om.id = ha.org_member_id
             WHERE om.admin_id = $1 AND ha.hall_id = $2 AND om.status = 'active'`,
            [req.admin.id, req.currentHallId]
          );
          scope = rows.length > 0 ? rows[0].scope : 'full';
          req.hallScope = scope;
        }

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
