import { describe, it, expect, beforeAll, vi } from 'vitest'
import { getPool } from '../../setup/db.js'
import { createAdmin } from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import { getSettings, updateSettings } from '../../../controllers/settings.Controller.js'

let testAdmin

beforeAll(async () => {
  await getPool()
  testAdmin = await createAdmin()
  const uniqueSlug = `test-org-${testAdmin.id.slice(0, 8)}-${Date.now()}`
  const orgRes = await getPool().query(
    `INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $2, $3) RETURNING id`,
    [`Test Admin's Org`, uniqueSlug, testAdmin.id]
  )
  const orgId = orgRes.rows[0].id

  await getPool().query(
    `INSERT INTO organization_settings (org_id, section, value)
     VALUES ($1, 'payment', $2::jsonb)`,
    [orgId, JSON.stringify({ convenience_fee: { model: 'per_ticket', amount: 15 }, gst_percentage: 18, gst_applies_to: 'convenience_fee', state_taxes: [] })]
  )
})

function mockReqRes(overrides = {}) {
  const req = {
    body: {},
    admin: testAdmin ? { id: testAdmin.id, role: 'admin' } : null,
    ...overrides
  }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

describe('getSettings', () => {
  it('returns convenience_fee and gst_percentage', async () => {
    const { req, res } = mockReqRes()
    await getSettings(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        convenience_fee_per_ticket: 15,
        gst_percentage: 18,
      })
    )
  })
})

describe('updateSettings', () => {
  it('rejects negative convenience_fee', async () => {
    const { req, res } = mockReqRes({ body: { convenience_fee_per_ticket: -5 } })
    await updateSettings(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rejects gst > 100', async () => {
    const { req, res } = mockReqRes({ body: { gst_percentage: 150 } })
    await updateSettings(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rejects non-numeric values', async () => {
    const { req, res } = mockReqRes({ body: { convenience_fee_per_ticket: 'abc' } })
    await updateSettings(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rejects empty body', async () => {
    const { req, res } = mockReqRes({ body: {} })
    await updateSettings(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'No valid fields to update' })
  })

  it('updates convenience fee successfully', async () => {
    const { req, res } = mockReqRes({ body: { convenience_fee_per_ticket: 20 } })
    await updateSettings(req, res)
    expect(res.status).toHaveBeenCalledWith(200)

    const pool = getPool()
    const orgCheck = await pool.query(`SELECT id FROM organizations WHERE owner_id = $1`, [testAdmin.id])
    const orgId = orgCheck.rows[0].id
    const result = await pool.query(`SELECT value FROM organization_settings WHERE org_id = $1 AND section = 'payment'`, [orgId])
    expect(result.rows[0].value.convenience_fee.amount).toBe(20)
  })

  it('updates gst percentage successfully', async () => {
    const { req, res } = mockReqRes({ body: { gst_percentage: 12.5 } })
    await updateSettings(req, res)
    expect(res.status).toHaveBeenCalledWith(200)

    const pool = getPool()
    const orgCheck = await pool.query(`SELECT id FROM organizations WHERE owner_id = $1`, [testAdmin.id])
    const orgId = orgCheck.rows[0].id
    const result = await pool.query(`SELECT value FROM organization_settings WHERE org_id = $1 AND section = 'payment'`, [orgId])
    expect(result.rows[0].value.gst_percentage).toBe(12.5)
  })
})
