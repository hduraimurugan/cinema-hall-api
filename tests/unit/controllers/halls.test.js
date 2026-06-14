import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { getPool, cleanupAll, closePool } from '../../setup/db.js'
import { createAdmin, createHall as createHallFactory } from '../../setup/factories.js'

vi.mock('../../../utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

import { getMyHalls, createHall, updateHall, deleteHall } from '../../../controllers/halls.Controller.js'

function mockReqRes(overrides = {}) {
  const req = { body: {}, params: {}, admin: { id: 'none' }, ...overrides }
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  return { req, res }
}

let admin

beforeAll(async () => {
  admin = await createAdmin()
})

afterEach(async () => {
  const p = getPool()
  await p.query(`DELETE FROM cinema_hall WHERE admin_id = $1`, [admin.id])
})

afterAll(async () => {
  await cleanupAll()
  await closePool()
})

describe('getMyHalls', () => {
  it('returns empty array when no halls', async () => {
    const { req, res } = mockReqRes({ admin: { id: admin.id } })
    await getMyHalls(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ halls: [] })
  })

  it('returns halls owned by admin', async () => {
    await createHallFactory(admin.id, { name: 'My Hall' })
    const { req, res } = mockReqRes({ admin: { id: admin.id } })
    await getMyHalls(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    const data = res.json.mock.calls[0][0]
    expect(data.halls).toHaveLength(1)
    expect(data.halls[0].name).toBe('My Hall')
  })
})

describe('createHall', () => {
  it('rejects missing required fields', async () => {
    const { req, res } = mockReqRes({ admin: { id: admin.id }, body: { name: 'Hall' } })
    await createHall(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('creates a hall with valid data', async () => {
    const { req, res } = mockReqRes({
      admin: { id: admin.id },
      body: { name: 'New Hall', location: 'City', district: 'District', state: 'State' },
    })
    await createHall(req, res)
    expect(res.status).toHaveBeenCalledWith(201)
    const data = res.json.mock.calls[0][0]
    expect(data.hall.name).toBe('New Hall')
    expect(data.hall.location).toBe('City')
  })

  it('accepts optional fields', async () => {
    const { req, res } = mockReqRes({
      admin: { id: admin.id },
      body: { name: 'Full Hall', location: 'City', district: 'D1', state: 'S1', phone: '123', description: 'Desc' },
    })
    await createHall(req, res)
    expect(res.status).toHaveBeenCalledWith(201)
    const data = res.json.mock.calls[0][0]
    expect(data.hall.phone).toBe('123')
  })
})

describe('updateHall', () => {
  let hallId

  beforeEach(async () => {
    const h = await createHallFactory(admin.id, { name: 'To Update' })
    hallId = h.id
  })

  it('returns 403 if hall not owned', async () => {
    const { req, res } = mockReqRes({ admin: { id: 'other-id' }, params: { id: hallId }, body: { name: 'Hacked' } })
    await updateHall(req, res)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('updates hall name', async () => {
    const { req, res } = mockReqRes({ admin: { id: admin.id }, params: { id: hallId }, body: { name: 'Updated Name' } })
    await updateHall(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].hall.name).toBe('Updated Name')
  })

  it('updates is_active', async () => {
    const { req, res } = mockReqRes({ admin: { id: admin.id }, params: { id: hallId }, body: { is_active: false } })
    await updateHall(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].hall.is_active).toBe(false)
  })
})

describe('deleteHall', () => {
  it('returns 403 if hall not owned', async () => {
    const { req, res } = mockReqRes({ admin: { id: 'other-id' }, params: { id: '00000000-0000-0000-0000-000000000000' } })
    await deleteHall(req, res)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('deletes owned hall', async () => {
    const h = await createHallFactory(admin.id, { name: 'To Delete' })
    const { req, res } = mockReqRes({ admin: { id: admin.id }, params: { id: h.id } })
    await deleteHall(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].message).toMatch(/deleted/i)
  })
})
