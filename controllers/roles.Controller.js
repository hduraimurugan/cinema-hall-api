import db from '../db.js';
import logger from '../utils/logger.js';
import * as teamService from '../services/team.service.js';
import { resolveOrgId } from '../middleware/requirePermission.js';

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
        const cloneResult = await client.query(
          `SELECT permission_id FROM role_permissions WHERE role_id = (
            SELECT id FROM roles WHERE org_id = $1 AND key = $2
          )`,
          [orgId, cloneFrom]
        );
        permsToAssign = cloneResult.rows.map(r => r.permission_id);
      } else if (permissionKeys && Array.isArray(permissionKeys) && permissionKeys.length > 0) {
        const permResult = await client.query(
          `SELECT id FROM permissions WHERE key = ANY($1)`,
          [permissionKeys]
        );
        permsToAssign = permResult.rows.map(r => r.id);
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
        `SELECT id, is_system FROM roles WHERE id = $1 AND org_id = $2`,
        [req.params.id, orgId]
      );
      if (roleResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Role not found' });
      }

      const role = roleResult.rows[0];

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
          `UPDATE roles SET ${sets.join(', ')}, permissions_version = permissions_version + 1, updated_at = now() WHERE id = $${idx}`,
          params
        );
      }

      if (permissionKeys && Array.isArray(permissionKeys)) {
        await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [role.id]);

        if (permissionKeys.length > 0) {
          const permResult = await client.query(
            `SELECT id FROM permissions WHERE key = ANY($1)`,
            [permissionKeys]
          );

          for (const permId of permResult.rows.map(r => r.id)) {
            await client.query(
              `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [role.id, permId]
            );
          }
        }
      }

      await client.query('COMMIT');

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

      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, permission_id FROM role_permissions WHERE role_id = $2`,
        [newRoleId, sourceId]
      );

      await client.query('COMMIT');

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
