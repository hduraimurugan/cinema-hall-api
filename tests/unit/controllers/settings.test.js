import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { getPool, cleanupAll, closePool } from '../../setup/db.js'
import { createSetting } from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import { getSettings, updateSettings } from '../../../controllers/settings.Controller.js'

function mockReqRes(overrides = {}) {
  const req = { body: {}, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

beforeAll(async () => {
  await getPool()
  await createSetting('convenience_fee_per_ticket', '15')
  await createSetting('gst_percentage', '18')
})

afterAll(async () => {
  await cleanupAll()
  await closePool()
})

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
    const result = await pool.query(`SELECT value FROM settings WHERE key = 'convenience_fee_per_ticket'`)
    expect(result.rows[0].value).toBe('20')
  })

  it('updates gst percentage successfully', async () => {
    const { req, res } = mockReqRes({ body: { gst_percentage: 12.5 } })
    await updateSettings(req, res)
    expect(res.status).toHaveBeenCalledWith(200)

    const pool = getPool()
    const result = await pool.query(`SELECT value FROM settings WHERE key = 'gst_percentage'`)
    expect(result.rows[0].value).toBe('12.5')
  })
})
