import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { getPool } from '../../setup/db.js'
import { createAdmin, createOrganization, createHall } from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import {
  requirePermission,
  loadAdminPermissions,
  resolveOrgId,
  clearOrgPermissionCache,
  clearPermissionCache,
} from '../../../middleware/requirePermission.js'
import { resolveOrgContext } from '../../../utils/generateTokenAndSetCookie.js'

let ownerAdmin, staffAdmin, outsiderAdmin
let orgId, hallId, staffRoleId

function mockReqRes(admin, overrides = {}) {
  const req = { admin, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  const next = vi.fn()
  return { req, res, next }
}

beforeAll(async () => {
  await getPool()

  ownerAdmin = await createAdmin()
  orgId = await createOrganization(ownerAdmin.id, { name: 'Perm Middleware Org' })
  const hall = await createHall(ownerAdmin.id, { name: 'Perm Hall', org_id: orgId })
  hallId = hall.id

  // Staff can read shows but not create them — the minimal shape that proves
  // both the allow and the deny path.
  staffAdmin = await createAdmin({ role: 'staff' })
  const role = await getPool().query(
    `INSERT INTO roles (org_id, key, label, is_system) VALUES ($1, 'viewer', 'Viewer', FALSE) RETURNING id`,
    [orgId]
  )
  staffRoleId = role.rows[0].id
  await getPool().query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions WHERE key IN ('shows.read', 'dashboard.view')`,
    [staffRoleId]
  )
  await getPool().query(
    `INSERT INTO organization_members (org_id, admin_id, role_id, status, joined_at)
     VALUES ($1, $2, $3, 'active', now())`,
    [orgId, staffAdmin.id, staffRoleId]
  )

  outsiderAdmin = await createAdmin()
})

beforeEach(() => clearOrgPermissionCache(orgId))

describe('resolveOrgId', () => {
  it('resolves through membership for a non-owner member', async () => {
    expect(await resolveOrgId(staffAdmin.id)).toBe(orgId)
  })

  it('returns null when the admin belongs to no organization', async () => {
    expect(await resolveOrgId(outsiderAdmin.id)).toBeNull()
  })

  it('prefers an org with halls over a hall-less org the admin owns', async () => {
    // The shape older backfills left behind: a staff member invited into a real
    // org who also owns an empty shell org of their own. With ownership as the
    // first sort key the shell won, so signing in put them in an empty tenant
    // as Owner instead of into the org they actually work in.
    const shellOrgId = await createOrganization(staffAdmin.id, { name: 'Shell Org' })
    expect(shellOrgId).not.toBe(orgId)

    const resolved = await resolveOrgId(staffAdmin.id)
    expect(resolved).toBe(orgId)

    // resolveOrgContext backs login and token refresh; it must agree with
    // resolveOrgId or /me and the token disagree about who the caller is.
    const ctx = await resolveOrgContext(staffAdmin.id)
    expect(ctx.orgId).toBe(orgId)
    expect(ctx.roleKey).toBe('viewer')

    await getPool().query('DELETE FROM organization_members WHERE org_id = $1', [shellOrgId])
    await getPool().query('DELETE FROM roles WHERE org_id = $1', [shellOrgId])
    await getPool().query('DELETE FROM organizations WHERE id = $1', [shellOrgId])
  })
})

describe('loadAdminPermissions', () => {
  it('returns the role permission set as a Set of keys', async () => {
    const perms = await loadAdminPermissions(staffAdmin.id, orgId)
    expect(perms.has('shows.read')).toBe(true)
    expect(perms.has('shows.create')).toBe(false)
  })

  it('is cached, and clearOrgPermissionCache drops every member of the org', async () => {
    await loadAdminPermissions(staffAdmin.id, orgId)

    await getPool().query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE key = 'movies.read'
       ON CONFLICT DO NOTHING`,
      [staffRoleId]
    )

    // Still the cached set — the write is invisible until the cache is cleared.
    expect((await loadAdminPermissions(staffAdmin.id, orgId)).has('movies.read')).toBe(false)

    clearOrgPermissionCache(orgId)
    expect((await loadAdminPermissions(staffAdmin.id, orgId)).has('movies.read')).toBe(true)

    await getPool().query(
      `DELETE FROM role_permissions WHERE role_id = $1
       AND permission_id = (SELECT id FROM permissions WHERE key = 'movies.read')`,
      [staffRoleId]
    )
    clearPermissionCache(staffAdmin.id, orgId)
  })
})

describe('requirePermission', () => {
  it('calls next when the permission is held', async () => {
    const { req, res, next } = mockReqRes({ id: staffAdmin.id, role: 'staff' }, { orgId })
    await requirePermission('shows.read')(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('returns 403 with the required key when it is not held', async () => {
    const { req, res, next } = mockReqRes({ id: staffAdmin.id, role: 'staff' }, { orgId })
    await requirePermission('shows.create')(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json.mock.calls[0][0]).toMatchObject({
      error: 'Permission denied',
      required: 'shows.create',
    })
  })

  it('lets superAdmin through without any membership', async () => {
    const { req, res, next } = mockReqRes({ id: outsiderAdmin.id, role: 'superAdmin' })
    await requirePermission('org.delete')(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('returns 403 when the admin has no organization', async () => {
    const { req, res, next } = mockReqRes({ id: outsiderAdmin.id, role: 'admin' })
    await requirePermission('shows.read')(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json.mock.calls[0][0].error).toBe('No organization found')
  })

  it('rejects a token minted before the role was last edited', async () => {
    const { rows } = await getPool().query(
      `SELECT permissions_version FROM roles WHERE id = $1`, [staffRoleId]
    )
    const stale = rows[0].permissions_version - 1

    const { req, res, next } = mockReqRes(
      { id: staffAdmin.id, role: 'staff', permissionsVersion: stale },
      { orgId }
    )
    await requirePermission('shows.read')(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
    // The client keys its silent refresh off this code.
    expect(res.json.mock.calls[0][0].code).toBe('TOKEN_STALE')
  })

  it('accepts a token whose version matches', async () => {
    const { rows } = await getPool().query(
      `SELECT permissions_version FROM roles WHERE id = $1`, [staffRoleId]
    )
    const { req, res, next } = mockReqRes(
      { id: staffAdmin.id, role: 'staff', permissionsVersion: rows[0].permissions_version },
      { orgId }
    )
    await requirePermission('shows.read')(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('blocks mutations on a read_only hall while allowing reads', async () => {
    const readCtx = mockReqRes(
      { id: staffAdmin.id, role: 'staff' },
      { orgId, currentHallId: hallId, hallScope: 'read_only' }
    )
    await requirePermission('shows.read')(readCtx.req, readCtx.res, readCtx.next)
    expect(readCtx.next).toHaveBeenCalled()

    // Grant the write so the denial can only come from the hall scope.
    await getPool().query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE key = 'shows.update' ON CONFLICT DO NOTHING`,
      [staffRoleId]
    )
    clearOrgPermissionCache(orgId)

    const writeCtx = mockReqRes(
      { id: staffAdmin.id, role: 'staff' },
      { orgId, currentHallId: hallId, hallScope: 'read_only' }
    )
    await requirePermission('shows.update')(writeCtx.req, writeCtx.res, writeCtx.next)

    expect(writeCtx.next).not.toHaveBeenCalled()
    expect(writeCtx.res.status).toHaveBeenCalledWith(403)
    expect(writeCtx.res.json.mock.calls[0][0].error).toBe('Read-only access')
  })
})
