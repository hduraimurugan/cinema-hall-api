import pool from '../db.js';
import logger from '../utils/logger.js';
import * as teamService from '../services/team.service.js';
import { TeamServiceError } from '../services/team.service.js';
import { resolveOrgId } from '../middleware/requirePermission.js';
import { recordAuditLog } from '../utils/auditLog.js';
import { notify } from '../services/notification/index.js';

// Validation failures from the service layer are client errors, not 500s.
const ERROR_STATUS = {
  ROLE_NOT_IN_ORG: 400,
  HALL_NOT_IN_ORG: 400,
  INVALID_HALL: 400,
  ALREADY_MEMBER: 409,
  CANNOT_MODIFY_OWNER: 403,
  CANNOT_REMOVE_OWNER: 403,
};

/**
 * Map a thrown error to a response. Returns true if it was handled as a
 * client error; false means the caller should fall through to its 500.
 */
const handleServiceError = (err, res) => {
  if (err instanceof TeamServiceError) {
    return res.status(ERROR_STATUS[err.code] ?? 400).json({ code: err.code, error: err.message });
  }
  // Unique-violation on the live-membership index — same meaning as ALREADY_MEMBER.
  if (err.code === '23505') {
    return res.status(409).json({ code: 'ALREADY_MEMBER', error: 'This user is already a member of this organization.' });
  }
  // Composite FK violation — a cross-org role or hall slipped past validation.
  if (err.code === '23503') {
    return res.status(400).json({ code: 'CROSS_ORG_REFERENCE', error: 'Referenced role or hall does not belong to this organization.' });
  }
  return null;
};

export const listOrgMembers = async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.admin.id);
    if (!orgId) return res.status(404).json({ error: 'Organization not found' });

    const { search, page, limit } = req.query;
    const result = await teamService.getOrgMembers(orgId, { search, page, limit });
    res.status(200).json(result);
  } catch (err) {
    logger.error('❌ listOrgMembers error:', { message: err.message });
    res.status(500).json({ error: 'Failed to list members' });
  }
};

export const inviteMember = async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.admin.id);
    if (!orgId) return res.status(404).json({ error: 'Organization not found' });

    const { email, roleId, halls } = req.body;
    if (!email || !roleId) {
      return res.status(400).json({ error: 'Email and roleId are required' });
    }

    const result = await teamService.inviteMember(orgId, req.admin.id, { email, roleId, halls });

    await recordAuditLog(req, {
      action: 'team.member.invite',
      resourceType: 'team_member',
      resourceId: result.memberId,
      resourceLabel: result.email,
    });

    res.status(201).json({
      message: 'Invite sent successfully',
      token: result.rawToken,
      memberId: result.memberId,
      email: result.email,
    });
  } catch (err) {
    if (handleServiceError(err, res)) return;
    logger.error('❌ inviteMember error:', { message: err.message });
    res.status(500).json({ error: 'Failed to send invite' });
  }
};

export const createMember = async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.admin.id);
    if (!orgId) return res.status(404).json({ error: 'Organization not found' });

    const { name, email, password, phone, roleId, halls } = req.body;
    if (!name || !email || !password || !roleId) {
      return res.status(400).json({ error: 'Name, email, password, and roleId are required' });
    }

    const result = await teamService.createMember(orgId, req.admin.id, { name, email, password, phone, roleId, halls });

    await recordAuditLog(req, {
      action: 'team.member.create',
      resourceType: 'team_member',
      resourceId: result.memberId,
      resourceLabel: result.name || result.email,
    });

    res.status(201).json({ message: 'Member created successfully', member: result });
  } catch (err) {
    if (handleServiceError(err, res)) return;
    logger.error('❌ createMember error:', { message: err.message });
    res.status(500).json({ error: 'Failed to create member' });
  }
};

export const getMember = async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.admin.id);
    if (!orgId) return res.status(404).json({ error: 'Organization not found' });

    const { rows } = await pool.query(
      `SELECT om.id, om.admin_id, om.status, om.joined_at, om.created_at,
              a.name, a.email, a.phone, a.last_login_at, a.avatar, a.role as user_role,
              r.id as role_id, r.key as role_key, r.label as role_label, r.description as role_description,
              (om.admin_id = o.owner_id) as is_owner
       FROM organization_members om
       JOIN cinema_admin_user a ON a.id = om.admin_id
       JOIN roles r ON r.id = om.role_id
       JOIN organizations o ON o.id = om.org_id
       WHERE om.id = $1 AND om.org_id = $2`,
      [req.params.id, orgId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    res.status(200).json({ member: rows[0] });
  } catch (err) {
    logger.error('❌ getMember error:', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch member' });
  }
};

export const updateMember = async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.admin.id);
    if (!orgId) return res.status(404).json({ error: 'Organization not found' });

    const { roleId, status } = req.body;
    const result = await teamService.updateMember(req.params.id, orgId, { roleId, status });

    if (!result) {
      return res.status(404).json({ error: 'Member not found' });
    }

    await recordAuditLog(req, {
      action: 'team.member.update',
      resourceType: 'team_member',
      resourceId: result.id,
      metadata: { roleId, status },
    });

    try {
      let roleLabel = null;
      if (result.role_id) {
        const { rows } = await pool.query(`SELECT label FROM roles WHERE id = $1`, [result.role_id]);
        roleLabel = rows[0]?.label || null;
      }
      await notify(
        'team_role_changed',
        { type: 'admin', id: result.admin_id, orgId },
        { memberId: result.id, roleId: result.role_id, roleLabel, status: result.status }
      );
    } catch (notifyError) {
      logger.error('[updateMember] Notification dispatch failed (non-fatal)', { message: notifyError.message });
    }

    res.status(200).json({ message: 'Member updated successfully', member: result });
  } catch (err) {
    if (handleServiceError(err, res)) return;
    logger.error('❌ updateMember error:', { message: err.message });
    res.status(500).json({ error: 'Failed to update member' });
  }
};

export const removeMember = async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.admin.id);
    if (!orgId) return res.status(404).json({ error: 'Organization not found' });

    const result = await teamService.removeMember(req.params.id, orgId);
    if (!result) {
      return res.status(404).json({ error: 'Member not found' });
    }

    await recordAuditLog(req, {
      action: 'team.member.remove',
      resourceType: 'team_member',
      resourceId: result.id,
    });

    try {
      await notify(
        'team_removed',
        { type: 'admin', id: result.admin_id, orgId },
        { memberId: result.id }
      );
    } catch (notifyError) {
      logger.error('[removeMember] Notification dispatch failed (non-fatal)', { message: notifyError.message });
    }

    res.status(200).json({ message: 'Member removed successfully' });
  } catch (err) {
    if (handleServiceError(err, res)) return;
    logger.error('❌ removeMember error:', { message: err.message });
    res.status(500).json({ error: 'Failed to remove member' });
  }
};

export const getMemberHalls = async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.admin.id);
    if (!orgId) return res.status(404).json({ error: 'Organization not found' });

    const halls = await teamService.getMemberHalls(req.params.id, orgId);
    res.status(200).json({ halls });
  } catch (err) {
    logger.error('❌ getMemberHalls error:', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch member halls' });
  }
};

export const assignHalls = async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.admin.id);
    if (!orgId) return res.status(404).json({ error: 'Organization not found' });

    const { halls } = req.body;
    if (!halls || !Array.isArray(halls)) {
      return res.status(400).json({ error: 'halls array is required' });
    }

    const assigned = req.body.halls.map(h => ({ ...h, assignedBy: req.admin.id }));
    const result = await teamService.assignHalls(req.params.id, orgId, assigned);

    if (!result) {
      return res.status(404).json({ error: 'Member not found' });
    }

    await recordAuditLog(req, {
      action: 'team.member.assign_halls',
      resourceType: 'team_member',
      resourceId: req.params.id,
      metadata: { halls: assigned },
    });

    res.status(200).json({ message: 'Halls assigned successfully', halls: result });
  } catch (err) {
    if (handleServiceError(err, res)) return;
    logger.error('❌ assignHalls error:', { message: err.message });
    res.status(500).json({ error: 'Failed to assign halls' });
  }
};

export const removeHallAssignment = async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.admin.id);
    if (!orgId) return res.status(404).json({ error: 'Organization not found' });

    const result = await teamService.removeHallAssignment(req.params.id, orgId, req.params.hallId);
    if (!result) {
      return res.status(404).json({ error: 'Hall assignment not found' });
    }

    await recordAuditLog(req, {
      action: 'team.member.remove_hall',
      resourceType: 'team_member',
      resourceId: req.params.id,
      hallId: req.params.hallId,
    });

    res.status(200).json({ message: 'Hall assignment removed successfully' });
  } catch (err) {
    if (handleServiceError(err, res)) return;
    logger.error('❌ removeHallAssignment error:', { message: err.message });
    res.status(500).json({ error: 'Failed to remove hall assignment' });
  }
};
