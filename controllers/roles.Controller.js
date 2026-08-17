import db from '../db.js';
import logger from '../utils/logger.js';
import * as teamService from '../services/team.service.js';
import {
  resolveOrgId,
  loadAdminPermissions,
  clearOrgPermissionCache,
} from '../middleware/requirePermission.js';

/**
 * Validate a requested permission set before it is written to a role.
 *
 * Two rules, in order:
 *  - every key must exist in the catalog (silently dropping unknown keys used
 *    to let a drifted UI wipe permissions it did not know how to render)
 *  - the caller may not grant a permission they do not themselves hold, or
 *    anyone with roles.manage could escalate to billing.manage / org.delete
 *
 * Returns { error, status } on rejection, or { ids } on success.
 */
async function resolvePermissionIds(client, req, orgId, permissionKeys) {
  const { rows } = await client.query(
    `SELECT id, key FROM permissions WHERE key = ANY($1)`,
    [permissionKeys]
  );

  const found = new Set(rows.map(r => r.key));
  const unknown = permissionKeys.filter(k => !found.has(k));
  if (unknown.length > 0) {
    return { status: 400, error: `Unknown permission keys: ${unknown.join(', ')}` };
  }

  if (req.admin.role !== 'superAdmin') {
    const mine = await loadAdminPermissions(req.admin.id, orgId);
    const escalated = permissionKeys.filter(k => !mine.has(k));
    if (escalated.length > 0) {
      return {
        status: 403,
        error: `You cannot grant permissions you do not hold: ${escalated.join(', ')}`,
      };
    }
  }

  return { ids: rows.map(r => r.id) };
}

export const listPermissions = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, key, label, resource FROM permissions ORDER BY resource, key`
    );
    res.status(200).json({ permissions: rows });
  } catch (err) {
    logger.error('❌ listPermissions error:', { message: err.message });
    res.status(500).json({ error: 'Failed to list permissions' });
  }
};

export const listRoles = async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.admin.id);
    if (!orgId) return res.status(404).json({ error: 'Organization not found' });

    const roles = await teamService.getOrgRoles(orgId);
    res.status(200).json({ roles });
  } catch (err) {
    logger.error('❌ listRoles error:', { message: err.message });
    res.status(500).json({ error: 'Failed to list roles' });
  }
};

export const createRole = async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.admin.id);
    if (!orgId) return res.status(404).json({ error: 'Organization not found' });

    const { key, label, description, permissionKeys, cloneFrom } = req.body;
    if (!key || !label) {
      return res.status(400).json({ error: 'Key and label are required' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        `SELECT id FROM roles WHERE org_id = $1 AND key = $2`,
        [orgId, key]
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Role with this key already exists' });
      }

      const roleResult = await client.query(
        `INSERT INTO roles (org_id, key, label, description, is_system)
         VALUES ($1, $2, $3, $4, FALSE)
         RETURNING id`,
        [orgId, key, label, description || null]
      );
      const roleId = roleResult.rows[0].id;

      let permsToAssign;
      if (cloneFrom) {
        // The dialog sends a role id; older callers send a role key. Accept both.
        const cloneResult = await client.query(
          `SELECT p.key
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
           WHERE r.org_id = $1 AND (r.id::text = $2 OR r.key = $2)`,
          [orgId, String(cloneFrom)]
        );
        // Route the cloned set through the same guard — otherwise cloning the
        // owner role would be a free escalation to every permission.
        const resolved = await resolvePermissionIds(
          client, req, orgId, cloneResult.rows.map(r => r.key)
        );
        if (resolved.error) {
          await client.query('ROLLBACK');
          return res.status(resolved.status).json({ error: resolved.error });
        }
        permsToAssign = resolved.ids;
      } else if (permissionKeys && Array.isArray(permissionKeys) && permissionKeys.length > 0) {
        const resolved = await resolvePermissionIds(client, req, orgId, permissionKeys);
        if (resolved.error) {
          await client.query('ROLLBACK');
          return res.status(resolved.status).json({ error: resolved.error });
        }
        permsToAssign = resolved.ids;
      } else {
        permsToAssign = [];
      }

      for (const permId of permsToAssign) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [roleId, permId]
        );
      }

      await client.query('COMMIT');
      clearOrgPermissionCache(orgId);

      const fullRole = await client.query(
        `SELECT r.id, r.key, r.label, r.description, r.is_system, r.created_at,
                COALESCE(
                  json_agg(json_build_object('id', p.id, 'key', p.key, 'label', p.label, 'resource', p.resource))
                  FILTER (WHERE p.id IS NOT NULL),
                  '[]'::json
                ) as permissions
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
         WHERE r.id = $1
         GROUP BY r.id`,
        [roleId]
      );

      res.status(201).json({ role: fullRole.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('❌ createRole error:', { message: err.message });
    res.status(500).json({ error: 'Failed to create role' });
  }
};

export const getRole = async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.admin.id);
    if (!orgId) return res.status(404).json({ error: 'Organization not found' });

    const { rows } = await db.query(
      `SELECT r.id, r.key, r.label, r.description, r.is_system, r.permissions_version, r.created_at, r.updated_at,
              COALESCE(
                json_agg(json_build_object('id', p.id, 'key', p.key, 'label', p.label, 'resource', p.resource))
                FILTER (WHERE p.id IS NOT NULL),
                '[]'::json
              ) as permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE r.id = $1 AND r.org_id = $2
       GROUP BY r.id`,
      [req.params.id, orgId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }

    res.status(200).json({ role: rows[0] });
  } catch (err) {
    logger.error('❌ getRole error:', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch role' });
  }
};

export const updateRole = async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.admin.id);
    if (!orgId) return res.status(404).json({ error: 'Organization not found' });

    const { label, description, permissionKeys } = req.body;

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const roleResult = await client.query(
        `SELECT id, key, is_system FROM roles WHERE id = $1 AND org_id = $2`,
        [req.params.id, orgId]
      );
      if (roleResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Role not found' });
      }

      const role = roleResult.rows[0];

      // The owner role is the org's recovery path. Letting its permissions be
      // edited means an owner can strip roles.manage from themselves and lock
      // the organization out permanently. Renaming it stays allowed.
      if (role.key === 'owner' && permissionKeys !== undefined) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'The Owner role always has full access and cannot be edited.',
        });
      }

      const sets = [];
      const params = [];
      let idx = 1;

      if (label !== undefined) {
        sets.push(`label = $${idx++}`);
        params.push(label);
      }
      if (description !== undefined) {
        sets.push(`description = $${idx++}`);
        params.push(description);
      }

      if (sets.length > 0) {
        params.push(role.id);
        await client.query(
          `UPDATE roles SET ${sets.join(', ')}, updated_at = now() WHERE id = $${idx}`,
          params
        );
      }

      if (permissionKeys && Array.isArray(permissionKeys)) {
        const resolved = await resolvePermissionIds(client, req, orgId, permissionKeys);
        if (resolved.error) {
          await client.query('ROLLBACK');
          return res.status(resolved.status).json({ error: resolved.error });
        }

        await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [role.id]);

        for (const permId of resolved.ids) {
          await client.query(
            `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [role.id, permId]
          );
        }

        // Bump only on a permission change — this is what invalidates the access
        // tokens of everyone holding the role. It used to sit inside the
        // label/description branch, so a permissions-only edit never took effect.
        await client.query(
          `UPDATE roles SET permissions_version = permissions_version + 1, updated_at = now() WHERE id = $1`,
          [role.id]
        );
      }

      await client.query('COMMIT');
      clearOrgPermissionCache(orgId);

      const fullRole = await db.query(
        `SELECT r.id, r.key, r.label, r.description, r.is_system, r.permissions_version, r.created_at, r.updated_at,
                COALESCE(
                  json_agg(json_build_object('id', p.id, 'key', p.key, 'label', p.label, 'resource', p.resource))
                  FILTER (WHERE p.id IS NOT NULL),
                  '[]'::json
                ) as permissions
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
         WHERE r.id = $1
         GROUP BY r.id`,
        [role.id]
      );

      res.status(200).json({ role: fullRole.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('❌ updateRole error:', { message: err.message });
    res.status(500).json({ error: 'Failed to update role' });
  }
};

export const deleteRole = async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.admin.id);
    if (!orgId) return res.status(404).json({ error: 'Organization not found' });

    const roleResult = await db.query(
      `SELECT id, is_system FROM roles WHERE id = $1 AND org_id = $2`,
      [req.params.id, orgId]
    );
    if (roleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }

    const role = roleResult.rows[0];

    if (role.is_system) {
      return res.status(400).json({ error: 'System roles cannot be deleted' });
    }

    const memberCount = await db.query(
      `SELECT COUNT(*) FROM organization_members WHERE role_id = $1 AND status IN ('active', 'suspended')`,
      [role.id]
    );
    if (parseInt(memberCount.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete role with active members. Reassign members first.' });
    }

    await db.query(`DELETE FROM roles WHERE id = $1`, [role.id]);
    clearOrgPermissionCache(orgId);
    res.status(200).json({ message: 'Role deleted successfully' });
  } catch (err) {
    logger.error('❌ deleteRole error:', { message: err.message });
    res.status(500).json({ error: 'Failed to delete role' });
  }
};

export const cloneRole = async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.admin.id);
    if (!orgId) return res.status(404).json({ error: 'Organization not found' });

    const { key, label, description } = req.body;
    if (!key || !label) {
      return res.status(400).json({ error: 'Key and label are required' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const sourceResult = await client.query(
        `SELECT id FROM roles WHERE id = $1 AND org_id = $2`,
        [req.params.id, orgId]
      );
      if (sourceResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Source role not found' });
      }
      const sourceId = sourceResult.rows[0].id;

      // Cloning copies a permission set wholesale, so it needs the same
      // escalation guard as an explicit grant.
      const sourceKeys = await client.query(
        `SELECT p.key FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = $1`,
        [sourceId]
      );
      const resolved = await resolvePermissionIds(
        client, req, orgId, sourceKeys.rows.map(r => r.key)
      );
      if (resolved.error) {
        await client.query('ROLLBACK');
        return res.status(resolved.status).json({ error: resolved.error });
      }

      const existing = await client.query(
        `SELECT id FROM roles WHERE org_id = $1 AND key = $2`,
        [orgId, key]
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Role with this key already exists' });
      }

      const roleResult = await client.query(
        `INSERT INTO roles (org_id, key, label, description, is_system)
         VALUES ($1, $2, $3, $4, FALSE)
         RETURNING id`,
        [orgId, key, label, description || null]
      );
      const newRoleId = roleResult.rows[0].id;

      for (const permId of resolved.ids) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [newRoleId, permId]
        );
      }

      await client.query('COMMIT');
      clearOrgPermissionCache(orgId);

      const fullRole = await db.query(
        `SELECT r.id, r.key, r.label, r.description, r.is_system, r.created_at,
                COALESCE(
                  json_agg(json_build_object('id', p.id, 'key', p.key, 'label', p.label, 'resource', p.resource))
                  FILTER (WHERE p.id IS NOT NULL),
                  '[]'::json
                ) as permissions
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
         WHERE r.id = $1
         GROUP BY r.id`,
        [newRoleId]
      );

      res.status(201).json({ role: fullRole.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('❌ cloneRole error:', { message: err.message });
    res.status(500).json({ error: 'Failed to clone role' });
  }
};
