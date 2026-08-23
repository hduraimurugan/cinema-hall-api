import pool from '../db.js'
import logger from './logger.js'
import { resolveOrgId } from '../middleware/requirePermission.js'

/**
 * Fire-and-forget business-action audit trail — mirrors logSecurityEvent's
 * contract (never throws, logs its own failure) so a logging bug can never
 * break the mutation it's attached to.
 */
export async function recordAuditLog(req, {
  action, resourceType, resourceId = null, resourceLabel = null,
  hallId = null, metadata = {},
}) {
  try {
    const admin = req.admin || {}
    if (!admin.id) return

    const orgId = req.orgId || admin.orgId || await resolveOrgId(admin.id)
    if (!orgId) return // no org context (e.g. superAdmin acting platform-wide)

    await pool.query(
      `INSERT INTO audit_logs
         (org_id, admin_id, actor_name, actor_role_key, action, resource_type,
          resource_id, resource_label, hall_id, metadata, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        orgId, admin.id, admin.name || null, admin.roleKey || null,
        action, resourceType, resourceId, resourceLabel,
        hallId || req.currentHallId || null,
        JSON.stringify(metadata || {}),
        req.ip || null, req.headers['user-agent'] || null,
      ]
    )
  } catch (err) {
    logger.error('Failed to write audit log:', { message: err.message, action, resourceType })
  }
}
