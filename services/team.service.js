import pool from '../db.js';
import logger from '../utils/logger.js';
import bcrypt from 'bcrypt';
import { loadAdminPermissions, clearPermissionCache } from '../middleware/requirePermission.js';
import { generateVerificationToken } from '../utils/generateVerificationToken.js';
import { hashToken } from '../utils/hashToken.js';

export { loadAdminPermissions, clearPermissionCache };

/**
 * Error carrying a machine-readable code so controllers can map it to a
 * 4xx instead of letting a raw Postgres constraint violation become a 500.
 */
export class TeamServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TeamServiceError';
    this.code = code;
  }
}

/**
 * Assert a role belongs to the given organization.
 * Without this the composite FK added in migration_phase4 rejects the
 * write with a raw 23503; with it the caller gets a clear 400.
 */
async function assertRoleInOrg(client, orgId, roleId) {
  const { rows } = await client.query(
    `SELECT id FROM roles WHERE id = $1 AND org_id = $2`,
    [roleId, orgId]
  );
  if (rows.length === 0) {
    throw new TeamServiceError('ROLE_NOT_IN_ORG', 'Role does not belong to this organization.');
  }
}

/**
 * Assert every hall in the list belongs to the given organization.
 * Guards the cross-org hall grant that hall_assignments used to allow.
 */
async function assertHallsInOrg(client, orgId, halls) {
  if (!halls || halls.length === 0) return;

  const hallIds = halls.map(h => h.hallId);
  if (hallIds.some(id => !id)) {
    throw new TeamServiceError('INVALID_HALL', 'Each hall entry requires a hallId.');
  }

  const { rows } = await client.query(
    `SELECT id FROM cinema_hall WHERE id = ANY($1::uuid[]) AND org_id = $2`,
    [hallIds, orgId]
  );

  if (rows.length !== new Set(hallIds).size) {
    throw new TeamServiceError('HALL_NOT_IN_ORG', 'One or more halls do not belong to this organization.');
  }
}

/**
 * Assert the target member is not the organization's registered owner
 * (organizations.owner_id). The owner must always remain an active member —
 * changing their role/status or removing them would either break the
 * "owner is a member" invariant migration_phase4 backfilled, or lock the
 * owner out of their own organization.
 */
async function assertNotOrgOwner(orgId, memberId, code, action) {
  const { rows } = await pool.query(
    `SELECT 1 FROM organization_members om
     JOIN organizations o ON o.id = om.org_id
     WHERE om.id = $1 AND om.org_id = $2 AND om.admin_id = o.owner_id`,
    [memberId, orgId]
  );
  if (rows.length > 0) {
    throw new TeamServiceError(code, `The organization owner cannot be ${action}. Transfer ownership first.`);
  }
}

export async function getOrgMembers(orgId, { search, page = 1, limit = 10 }) {
  const safeLimit = Math.min(Math.max(parseInt(limit) || 10, 1), 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * safeLimit;
  const searchParam = search?.trim() || null;

  const [membersResult, countResult] = await Promise.all([
    pool.query(
      `SELECT
        om.id, om.admin_id, om.status, om.joined_at, om.created_at,
        a.name, a.email, a.phone, a.last_login_at, a.avatar,
        r.id as role_id, r.key as role_key, r.label as role_label,
        (om.admin_id = o.owner_id) as is_owner,
        COALESCE(
          (SELECT COUNT(*) FROM hall_assignments ha WHERE ha.org_member_id = om.id),
          0
        )::int as hall_count
       FROM organization_members om
       JOIN cinema_admin_user a ON a.id = om.admin_id
       JOIN roles r ON r.id = om.role_id
       JOIN organizations o ON o.id = om.org_id
       WHERE om.org_id = $1
         AND ($2::text IS NULL
           OR a.name ILIKE '%' || $2 || '%'
           OR a.email ILIKE '%' || $2 || '%')
       ORDER BY om.created_at DESC
       LIMIT $3 OFFSET $4`,
      [orgId, searchParam, safeLimit, offset]
    ),
    pool.query(
      `SELECT COUNT(*) FROM organization_members om
       JOIN cinema_admin_user a ON a.id = om.admin_id
       WHERE om.org_id = $1
         AND ($2::text IS NULL
           OR a.name ILIKE '%' || $2 || '%'
           OR a.email ILIKE '%' || $2 || '%')`,
      [orgId, searchParam]
    ),
  ]);

  return {
    members: membersResult.rows,
    total: parseInt(countResult.rows[0].count),
  };
}

export async function createMember(orgId, createdBy, { name, email, password, phone, roleId, halls }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await assertRoleInOrg(client, orgId, roleId);
    await assertHallsInOrg(client, orgId, halls);

    const hashedPassword = await bcrypt.hash(password, 12);

    const userResult = await client.query(
      `INSERT INTO cinema_admin_user (name, email, password, phone, role, email_verified, email_verified_at)
       VALUES ($1, $2, $3, $4, 'staff', TRUE, now())
       RETURNING id, name, email, phone`,
      [name, email.toLowerCase(), hashedPassword, phone || null]
    );
    const admin = userResult.rows[0];

    const memberResult = await client.query(
      `INSERT INTO organization_members (org_id, admin_id, role_id, status, invited_by, joined_at)
       VALUES ($1, $2, $3, 'active', $4, now())
       RETURNING id`,
      [orgId, admin.id, roleId, createdBy]
    );
    const memberId = memberResult.rows[0].id;

    if (halls && Array.isArray(halls) && halls.length > 0) {
      for (const hall of halls) {
        await client.query(
          `INSERT INTO hall_assignments (org_member_id, org_id, hall_id, scope, assigned_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (org_member_id, hall_id) DO UPDATE SET scope = EXCLUDED.scope`,
          [memberId, orgId, hall.hallId, hall.scope || 'full', createdBy]
        );
      }
    }

    await client.query('COMMIT');

    clearPermissionCache(admin.id, orgId);

    return { memberId, adminId: admin.id, name: admin.name, email: admin.email };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function inviteMember(orgId, invitedBy, { email, roleId, halls }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await assertRoleInOrg(client, orgId, roleId);
    await assertHallsInOrg(client, orgId, halls);

    let adminResult = await client.query(
      `SELECT id, name, email FROM cinema_admin_user WHERE email = $1`,
      [email.toLowerCase()]
    );

    let adminId;
    if (adminResult.rows.length === 0) {
      const insertResult = await client.query(
        `INSERT INTO cinema_admin_user (name, email, role, email_verified)
         VALUES ($1, $2, 'staff', FALSE)
         RETURNING id, name, email`,
        [email.toLowerCase(), email.toLowerCase()]
      );
      adminId = insertResult.rows[0].id;
    } else {
      adminId = adminResult.rows[0].id;
    }

    const existingLive = await client.query(
      `SELECT id, status FROM organization_members
        WHERE org_id = $1 AND admin_id = $2 AND status <> 'removed'`,
      [orgId, adminId]
    );
    if (existingLive.rows.length > 0) {
      throw new TeamServiceError(
        'ALREADY_MEMBER',
        `This user is already ${existingLive.rows[0].status} in this organization.`
      );
    }

    // A previously removed member keeps their row (history), so re-inviting
    // means reviving it rather than inserting a second one. The partial
    // unique index added in migration_phase4 only covers live memberships.
    const revived = await client.query(
      `UPDATE organization_members
          SET role_id = $3, status = 'invited', invited_by = $4,
              invited_at = now(), joined_at = NULL, removed_at = NULL
        WHERE org_id = $1 AND admin_id = $2 AND status = 'removed'
        RETURNING id`,
      [orgId, adminId, roleId, invitedBy]
    );

    let memberId;
    if (revived.rows.length > 0) {
      memberId = revived.rows[0].id;
    } else {
      const memberResult = await client.query(
        `INSERT INTO organization_members (org_id, admin_id, role_id, status, invited_by, invited_at)
         VALUES ($1, $2, $3, 'invited', $4, now())
         RETURNING id`,
        [orgId, adminId, roleId, invitedBy]
      );
      memberId = memberResult.rows[0].id;
    }

    if (halls && Array.isArray(halls) && halls.length > 0) {
      for (const hall of halls) {
        await client.query(
          `INSERT INTO hall_assignments (org_member_id, org_id, hall_id, scope, assigned_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (org_member_id, hall_id) DO UPDATE SET scope = EXCLUDED.scope`,
          [memberId, orgId, hall.hallId, hall.scope || 'full', invitedBy]
        );
      }
    }

    const rawToken = generateVerificationToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await client.query(
      `INSERT INTO admin_verification_tokens (admin_id, token_hash, expires_at, purpose)
       VALUES ($1, $2, $3, 'team_invite')`,
      [adminId, tokenHash, expiresAt]
    );

    await client.query('COMMIT');

    return { rawToken, memberId, adminId, email: email.toLowerCase() };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function validateInviteToken(rawToken) {
  const tokenHash = hashToken(rawToken);

  const result = await pool.query(
    `SELECT avt.admin_id, avt.expires_at, a.email, a.name,
            om.org_id, o.name as org_name,
            inviter.name as invited_by_name
     FROM admin_verification_tokens avt
     JOIN cinema_admin_user a ON a.id = avt.admin_id
     JOIN organization_members om ON om.admin_id = a.id AND om.status = 'invited'
     JOIN organizations o ON o.id = om.org_id
     LEFT JOIN cinema_admin_user inviter ON inviter.id = om.invited_by
     WHERE avt.token_hash = $1 AND avt.purpose = 'team_invite'
     LIMIT 1`,
    [tokenHash]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const record = result.rows[0];

  if (new Date(record.expires_at) < new Date()) {
    return { expired: true };
  }

  return {
    adminId: record.admin_id,
    email: record.email,
    name: record.name,
    orgName: record.org_name,
    invitedBy: record.invited_by_name,
  };
}

export async function acceptInvite(rawToken, newPassword) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tokenHash = hashToken(rawToken);
    const tokenResult = await client.query(
      `SELECT avt.id, avt.admin_id, avt.expires_at
       FROM admin_verification_tokens avt
       WHERE avt.token_hash = $1 AND avt.purpose = 'team_invite'`,
      [tokenHash]
    );

    if (tokenResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { error: 'INVALID_TOKEN', message: 'Invalid invite link.' };
    }

    const record = tokenResult.rows[0];

    if (new Date(record.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return { error: 'TOKEN_EXPIRED', message: 'Invite link has expired.' };
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await client.query(
      `UPDATE cinema_admin_user SET password = $1, email_verified = TRUE, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $2`,
      [hashedPassword, record.admin_id]
    );

    await client.query(
      `UPDATE organization_members SET status = 'active', joined_at = now() WHERE admin_id = $1 AND status = 'invited'`,
      [record.admin_id]
    );

    await client.query(
      `DELETE FROM admin_verification_tokens WHERE admin_id = $1 AND purpose = 'team_invite'`,
      [record.admin_id]
    );

    await client.query('COMMIT');
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateMember(memberId, orgId, updates) {
  if (updates.roleId !== undefined || updates.status !== undefined) {
    await assertNotOrgOwner(orgId, memberId, 'CANNOT_MODIFY_OWNER', 'modified');
  }

  const sets = [];
  const params = [];
  let idx = 1;

  if (updates.roleId !== undefined) {
    await assertRoleInOrg(pool, orgId, updates.roleId);
    sets.push(`role_id = $${idx++}`);
    params.push(updates.roleId);
  }
  if (updates.status !== undefined) {
    sets.push(`status = $${idx++}`);
    params.push(updates.status);
    // Keep removed_at consistent with the status the row is moving to.
    sets.push(`removed_at = ${updates.status === 'removed' ? 'now()' : 'NULL'}`);
  }

  if (sets.length === 0) return null;

  params.push(memberId, orgId);
  const result = await pool.query(
    `UPDATE organization_members SET ${sets.join(', ')} WHERE id = $${idx++} AND org_id = $${idx++} RETURNING id, org_id, admin_id, role_id, status`,
    params
  );

  if (result.rows.length > 0) {
    const row = result.rows[0];
    clearPermissionCache(row.admin_id, orgId);
  }

  return result.rows[0] || null;
}

export async function removeMember(memberId, orgId) {
  await assertNotOrgOwner(orgId, memberId, 'CANNOT_REMOVE_OWNER', 'removed');

  const result = await pool.query(
    `UPDATE organization_members
        SET status = 'removed', removed_at = now()
      WHERE id = $1 AND org_id = $2
      RETURNING id, admin_id`,
    [memberId, orgId]
  );

  if (result.rows.length > 0) {
    clearPermissionCache(result.rows[0].admin_id, orgId);
  }

  return result.rows[0] || null;
}

export async function getMemberHalls(memberId, orgId) {
  const { rows } = await pool.query(
    `SELECT ha.id, ha.hall_id, ha.scope, ha.created_at,
            h.name as hall_name, h.location as hall_location
     FROM hall_assignments ha
     JOIN cinema_hall h ON h.id = ha.hall_id
     JOIN organization_members om ON om.id = ha.org_member_id
     WHERE ha.org_member_id = $1 AND om.org_id = $2`,
    [memberId, orgId]
  );
  return rows;
}

export async function assignHalls(memberId, orgId, halls) {
  // Owners already get full access to every hall in their org via the
  // org-wide-role path in requireActiveHall — editing their individual
  // hall_assignments rows here has no real effect and only invites confusion.
  await assertNotOrgOwner(orgId, memberId, 'CANNOT_MODIFY_OWNER', 'modified');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const memCheck = await client.query(
      `SELECT id FROM organization_members WHERE id = $1 AND org_id = $2`,
      [memberId, orgId]
    );
    if (memCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    // The member was checked above; the halls were not. Without this a
    // member of org A could be granted a hall belonging to org B.
    await assertHallsInOrg(client, orgId, halls);

    for (const hall of halls) {
      await client.query(
        `INSERT INTO hall_assignments (org_member_id, org_id, hall_id, scope, assigned_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (org_member_id, hall_id) DO UPDATE SET scope = EXCLUDED.scope`,
        [memberId, orgId, hall.hallId, hall.scope || 'full', hall.assignedBy || null]
      );
    }

    await client.query('COMMIT');
    return await getMemberHalls(memberId, orgId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function removeHallAssignment(memberId, orgId, hallId) {
  await assertNotOrgOwner(orgId, memberId, 'CANNOT_MODIFY_OWNER', 'modified');

  const result = await pool.query(
    `DELETE FROM hall_assignments ha
     USING organization_members om
     WHERE ha.org_member_id = om.id
       AND ha.org_member_id = $1
       AND om.org_id = $2
       AND ha.hall_id = $3
     RETURNING ha.id`,
    [memberId, orgId, hallId]
  );
  return result.rows[0] || null;
}

export async function getOrgRoles(orgId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.key, r.label, r.description, r.is_system, r.created_at,
            COALESCE(m.member_count, 0)::int as member_count,
            COALESCE(p.permission_count, 0)::int as permission_count
     FROM roles r
     LEFT JOIN (
       SELECT role_id, COUNT(*) as member_count
       FROM organization_members
       WHERE org_id = $1 AND status IN ('active', 'suspended')
       GROUP BY role_id
     ) m ON m.role_id = r.id
     LEFT JOIN (
       SELECT role_id, COUNT(*) as permission_count
       FROM role_permissions
       GROUP BY role_id
     ) p ON p.role_id = r.id
     WHERE r.org_id = $1
     ORDER BY r.is_system DESC, r.label ASC`,
    [orgId]
  );
  return rows;
}
