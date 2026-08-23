import db from '../db.js';
import logger from '../utils/logger.js';
import { resolveOrgId } from '../middleware/requirePermission.js';

// GET /api/audit-logs
export const getAuditLogs = async (req, res) => {
  try {
    // A superAdmin account can still be an org member (e.g. an org owner whose
    // platform role happens to be superAdmin), so resolve their own org first,
    // same as everyone else. Only a platform-only superAdmin with no org
    // membership at all needs to pass ?orgId= explicitly.
    let orgId = req.query.orgId || await resolveOrgId(req.admin.id);
    if (!orgId) {
      if (req.admin.role === 'superAdmin') {
        return res.status(400).json({ error: 'orgId query parameter is required' });
      }
      return res.status(404).json({ error: 'Organization not found' });
    }

    const { adminId, resourceType, action, hallId, from_date, to_date } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const conditions = ['al.org_id = $1'];
    const params = [orgId];
    let idx = 2;

    if (adminId) {
      conditions.push(`al.admin_id = $${idx++}`);
      params.push(adminId);
    }
    if (resourceType) {
      conditions.push(`al.resource_type = $${idx++}`);
      params.push(resourceType);
    }
    if (action) {
      conditions.push(`al.action = $${idx++}`);
      params.push(action);
    }
    if (hallId) {
      conditions.push(`al.hall_id = $${idx++}`);
      params.push(hallId);
    }
    if (from_date) {
      conditions.push(`al.created_at::date >= $${idx++}`);
      params.push(from_date);
    }
    if (to_date) {
      conditions.push(`al.created_at::date <= $${idx++}`);
      params.push(to_date);
    }

    const where = conditions.join(' AND ');

    const [dataResult, countResult] = await Promise.all([
      db.query(
        `SELECT al.id, al.action, al.resource_type, al.resource_id, al.resource_label,
                al.admin_id, al.actor_name, al.actor_role_key,
                al.hall_id, ch.name AS hall_name,
                al.metadata, al.ip_address, al.created_at
         FROM audit_logs al
         LEFT JOIN cinema_hall ch ON ch.id = al.hall_id
         WHERE ${where}
         ORDER BY al.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
      db.query(`SELECT COUNT(*) FROM audit_logs al WHERE ${where}`, params),
    ]);

    res.status(200).json({
      logs: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
    });
  } catch (err) {
    logger.error('❌ getAuditLogs error:', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
};
