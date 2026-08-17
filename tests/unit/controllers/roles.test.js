import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { getPool } from '../../setup/db.js'
import { createAdmin, createOrganization } from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import {
  listPermissions, listRoles, getRole, createRole, updateRole, deleteRole, cloneRole,
} from '../../../controllers/roles.Controller.js'
import { clearOrgPermissionCache } from '../../../middleware/requirePermission.js'

let ownerAdmin   // holds every permission, via the 'owner' role
let limitedAdmin // holds a deliberately narrow set
let orgId
let managerRoleId

function mockReqRes(admin, overrides = {}) {
  const req = { body: {}, params: {}, query: {}, admin, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

const jsonOf = (res) => res.json.mock.calls[0][0]

async function keysOf(roleId) {
  const { rows } = await getPool().query(
    `SELECT p.key FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1 ORDER BY p.key`,
    [roleId]
  )
  return rows.map(r => r.key)
}

beforeAll(async () => {
  await getPool()
  ownerAdmin = await createAdmin()
  orgId = await createOrganization(ownerAdmin.id, { name: 'Roles Test Org' })

  // A manager-ish role used as the edit target throughout.
  const roleRes = await getPool().query(
    `INSERT INTO roles (org_id, key, label, is_system) VALUES ($1, 'manager', 'Manager', TRUE) RETURNING id`,
    [orgId]
  )
  managerRoleId = roleRes.rows[0].id
  await getPool().query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions WHERE key IN ('shows.read', 'shows.create', 'dashboard.view')`,
    [managerRoleId]
  )

  // A second admin whose role grants roles.manage but little else — the actor
  // used to prove the escalation guard bites.
  limitedAdmin = await createAdmin()
  const limitedRole = await getPool().query(
    `INSERT INTO roles (org_id, key, label, is_system) VALUES ($1, 'limited', 'Limited', FALSE) RETURNING id`,
    [orgId]
  )
  await getPool().query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions WHERE key IN ('roles.read', 'roles.manage', 'shows.read')`,
    [limitedRole.rows[0].id]
  )
  await getPool().query(
    `INSERT INTO organization_members (org_id, admin_id, role_id, status, joined_at)
     VALUES ($1, $2, $3, 'active', now())`,
    [orgId, limitedAdmin.id, limitedRole.rows[0].id]
  )
})

beforeEach(() => {
  // loadAdminPermissions caches for 5 minutes; tests mutate grants faster than that.
  clearOrgPermissionCache(orgId)
})

describe('listPermissions', () => {
  it('returns the full catalog with key, label and resource', async () => {
    const { req, res } = mockReqRes({ id: ownerAdmin.id, role: 'admin' })
    await listPermissions(req, res)
    expect(res.status).toHaveBeenCalledWith(200)

    const { permissions } = jsonOf(res)
    expect(permissions.length).toBeGreaterThan(50)
    expect(permissions[0]).toHaveProperty('key')
    expect(permissions[0]).toHaveProperty('label')
    expect(permissions[0]).toHaveProperty('resource')
    expect(permissions.map(p => p.key)).toContain('halls.read')
  })
})

describe('listRoles', () => {
  it('includes member and permission counts', async () => {
    const { req, res } = mockReqRes({ id: ownerAdmin.id, role: 'admin' })
    await listRoles(req, res)

    const role = jsonOf(res).roles.find(r => r.key === 'manager')
    expect(role.permission_count).toBe(3)
    expect(role.member_count).toBe(0)
  })
})

describe('getRole', () => {
  it('returns permissions as objects carrying a key', async () => {
    const { req, res } = mockReqRes({ id: ownerAdmin.id, role: 'admin' }, { params: { id: managerRoleId } })
    await getRole(req, res)

    const { role } = jsonOf(res)
    expect(role.permissions.map(p => p.key).sort())
      .toEqual(['dashboard.view', 'shows.create', 'shows.read'])
  })
})

describe('updateRole', () => {
  it('replaces the permission set and bumps permissions_version', async () => {
    const before = await getPool().query(`SELECT permissions_version FROM roles WHERE id = $1`, [managerRoleId])

    const { req, res } = mockReqRes(
      { id: ownerAdmin.id, role: 'admin' },
      { params: { id: managerRoleId }, body: { permissionKeys: ['shows.read', 'bookings.read'] } }
    )
    await updateRole(req, res)
    expect(res.status).toHaveBeenCalledWith(200)

    expect(await keysOf(managerRoleId)).toEqual(['bookings.read', 'shows.read'])

    // A permissions-only edit must invalidate existing tokens; the bump used to
    // be skipped unless the label or description also changed.
    const after = await getPool().query(`SELECT permissions_version FROM roles WHERE id = $1`, [managerRoleId])
    expect(after.rows[0].permissions_version).toBe(before.rows[0].permissions_version + 1)
  })

  it('rejects unknown permission keys instead of silently dropping them', async () => {
    const snapshot = await keysOf(managerRoleId)

    const { req, res } = mockReqRes(
      { id: ownerAdmin.id, role: 'admin' },
      { params: { id: managerRoleId }, body: { permissionKeys: ['shows.read', 'refunds.approve'] } }
    )
    await updateRole(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(jsonOf(res).error).toContain('refunds.approve')
    expect(await keysOf(managerRoleId)).toEqual(snapshot)
  })

  it('refuses to edit the owner role permissions', async () => {
    const owner = await getPool().query(
      `SELECT id FROM roles WHERE org_id = $1 AND key = 'owner'`, [orgId]
    )
    const ownerRoleId = owner.rows[0].id
    const snapshot = await keysOf(ownerRoleId)

    const { req, res } = mockReqRes(
      { id: ownerAdmin.id, role: 'admin' },
      { params: { id: ownerRoleId }, body: { permissionKeys: ['dashboard.view'] } }
    )
    await updateRole(req, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(await keysOf(ownerRoleId)).toEqual(snapshot)
  })

  it('still allows renaming the owner role', async () => {
    const owner = await getPool().query(
      `SELECT id FROM roles WHERE org_id = $1 AND key = 'owner'`, [orgId]
    )
    const { req, res } = mockReqRes(
      { id: ownerAdmin.id, role: 'admin' },
      { params: { id: owner.rows[0].id }, body: { description: 'Runs the place' } }
    )
    await updateRole(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('blocks granting a permission the caller does not hold', async () => {
    const snapshot = await keysOf(managerRoleId)

    const { req, res } = mockReqRes(
      { id: limitedAdmin.id, role: 'admin' },
      { params: { id: managerRoleId }, body: { permissionKeys: ['shows.read', 'billing.manage'] } }
    )
    await updateRole(req, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(jsonOf(res).error).toContain('billing.manage')
    expect(await keysOf(managerRoleId)).toEqual(snapshot)
  })

  it('allows granting permissions the caller does hold', async () => {
    const { req, res } = mockReqRes(
      { id: limitedAdmin.id, role: 'admin' },
      { params: { id: managerRoleId }, body: { permissionKeys: ['shows.read'] } }
    )
    await updateRole(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(await keysOf(managerRoleId)).toEqual(['shows.read'])
  })

  it('lets superAdmin bypass the escalation guard', async () => {
    const { req, res } = mockReqRes(
      { id: limitedAdmin.id, role: 'superAdmin' },
      { params: { id: managerRoleId }, body: { permissionKeys: ['billing.manage'] } }
    )
    await updateRole(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(await keysOf(managerRoleId)).toEqual(['billing.manage'])
  })
})

describe('createRole', () => {
  it('persists the requested permissionKeys', async () => {
    const key = `custom_${Date.now()}`
    const { req, res } = mockReqRes(
      { id: ownerAdmin.id, role: 'admin' },
      { body: { key, label: 'Custom', permissionKeys: ['shows.read', 'dashboard.view'] } }
    )
    await createRole(req, res)
    expect(res.status).toHaveBeenCalledWith(201)

    const { role } = jsonOf(res)
    expect(role.permissions.map(p => p.key).sort()).toEqual(['dashboard.view', 'shows.read'])
  })

  it('accepts cloneFrom as a role id as well as a role key', async () => {
    const { req, res } = mockReqRes(
      { id: ownerAdmin.id, role: 'admin' },
      { body: { key: `byid_${Date.now()}`, label: 'By Id', cloneFrom: managerRoleId } }
    )
    await createRole(req, res)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(jsonOf(res).role.permissions.length).toBe(await keysOf(managerRoleId).then(k => k.length))
  })

  it('applies the escalation guard when cloning', async () => {
    const ownerRole = await getPool().query(
      `SELECT id FROM roles WHERE org_id = $1 AND key = 'owner'`, [orgId]
    )
    const { req, res } = mockReqRes(
      { id: limitedAdmin.id, role: 'admin' },
      { body: { key: `esc_${Date.now()}`, label: 'Escalate', cloneFrom: ownerRole.rows[0].id } }
    )
    await createRole(req, res)
    expect(res.status).toHaveBeenCalledWith(403)
  })
})

describe('cloneRole', () => {
  it('copies the source permission set', async () => {
    const { req, res } = mockReqRes(
      { id: ownerAdmin.id, role: 'admin' },
      { params: { id: managerRoleId }, body: { key: `clone_${Date.now()}`, label: 'Cloned' } }
    )
    await cloneRole(req, res)
    expect(res.status).toHaveBeenCalledWith(201)

    const cloned = jsonOf(res).role.permissions.map(p => p.key).sort()
    expect(cloned).toEqual(await keysOf(managerRoleId))
  })
})

describe('deleteRole', () => {
  it('refuses to delete a system role', async () => {
    const { req, res } = mockReqRes(
      { id: ownerAdmin.id, role: 'admin' },
      { params: { id: managerRoleId } }
    )
    await deleteRole(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})
