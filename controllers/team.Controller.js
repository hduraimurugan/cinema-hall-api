import pool from '../db.js';
import logger from '../utils/logger.js';
import * as teamService from '../services/team.service.js';
import { resolveOrgId } from '../middleware/requirePermission.js';

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
    res.status(201).json({
      message: 'Invite sent successfully',
      token: result.rawToken,
      memberId: result.memberId,
      email: result.email,
    });
  } catch (err) {
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
    res.status(201).json({ message: 'Member created successfully', member: result });
  } catch (err) {
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
              r.id as role_id, r.key as role_key, r.label as role_label, r.description as role_description
       FROM organization_members om
       JOIN cinema_admin_user a ON a.id = om.admin_id
       JOIN roles r ON r.id = om.role_id
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

    res.status(200).json({ message: 'Member updated successfully', member: result });
  } catch (err) {
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

    res.status(200).json({ message: 'Member removed successfully' });
  } catch (err) {
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

    res.status(200).json({ message: 'Halls assigned successfully', halls: result });
  } catch (err) {
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

    res.status(200).json({ message: 'Hall assignment removed successfully' });
  } catch (err) {
    logger.error('❌ removeHallAssignment error:', { message: err.message });
    res.status(500).json({ error: 'Failed to remove hall assignment' });
  }
};
